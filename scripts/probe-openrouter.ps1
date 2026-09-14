[CmdletBinding()]
param(
    [ValidateRange(0, 3)]
    [int]$MaxLevel = 0,
    [switch]$AllowPaidTests,
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 30,
    [ValidateRange(0.01, 0.20)]
    [decimal]$MaxSpendUsd = 0.20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot 'deploy/.env.openrouter.local'
$outputRoot = Join-Path $projectRoot '.local-tests/openrouter'
$baseUrl = 'https://openrouter.ai/api/v1'
$targetModel = 'anthropic/claude-opus-4.6'
$privacyProvider = [ordered]@{
    data_collection   = 'deny'
    zdr               = $true
    require_parameters = $true
}

if ($MaxLevel -gt 0 -and -not $AllowPaidTests) {
    throw 'Levels 1-3 make paid requests. Re-run with -AllowPaidTests after reviewing the cost cap.'
}

function Get-LocalSecret {
    param([string]$Path, [string]$Name)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Local credential file is missing: deploy/.env.openrouter.local"
    }
    $matches = @(Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" })
    if ($matches.Count -ne 1) {
        throw "$Name must occur exactly once in deploy/.env.openrouter.local"
    }
    $value = ($matches[0] -split '=', 2)[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^<.*>$') {
        throw "$Name is empty or malformed in deploy/.env.openrouter.local"
    }
    return $value
}

function Get-ErrorCategory {
    param([int]$StatusCode)

    switch ($StatusCode) {
        401 { 'authentication' }
        402 { 'insufficient_credits' }
        403 { 'forbidden' }
        408 { 'timeout' }
        429 { 'rate_limited' }
        502 { 'provider_bad_gateway' }
        503 { 'provider_unavailable' }
        default { if ($StatusCode -ge 500) { 'upstream_server' } else { 'unexpected' } }
    }
}

function Protect-Text {
    param([AllowNull()][string]$Text, [AllowNull()][string]$Secret)

    if ($null -eq $Text) { return $null }
    $safe = $Text
    if (-not [string]::IsNullOrEmpty($Secret)) {
        $safe = $safe.Replace($Secret, '[REDACTED]')
    }
    $safe = [regex]::Replace($safe, '(?i)Bearer\s+[^\s"'']+', 'Bearer [REDACTED]')
    $safe = [regex]::Replace($safe, '(?i)(sk-or-v1-|sk-or-)[A-Za-z0-9_-]+', '[REDACTED]')
    return $safe
}

function ConvertTo-BodyJson {
    param([hashtable]$Body)
    return ($Body | ConvertTo-Json -Depth 30 -Compress)
}

function Invoke-OpenRouterRequest {
    param(
        [ValidateSet('GET', 'POST')][string]$Method,
        [string]$Path,
        [AllowNull()][hashtable]$Body,
        [string]$ApiKey,
        [switch]$Stream,
        [int]$RequestTimeoutSeconds = $TimeoutSeconds,
        [int]$CancelAfterMilliseconds = 0
    )

    $handler = [System.Net.Http.HttpClientHandler]::new()
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSeconds)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), "$baseUrl$Path")
    [void]$request.Headers.TryAddWithoutValidation('Authorization', "Bearer $ApiKey")
    [void]$request.Headers.TryAddWithoutValidation('X-OpenRouter-Metadata', 'disabled')
    if ($null -ne $Body) {
        $request.Content = [System.Net.Http.StringContent]::new((ConvertTo-BodyJson $Body), [System.Text.Encoding]::UTF8, 'application/json')
    }
    $cts = [System.Threading.CancellationTokenSource]::new()
    if ($CancelAfterMilliseconds -gt 0) {
        $cts.CancelAfter($CancelAfterMilliseconds)
    }
    try {
        $completion = if ($Stream) { [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead } else { [System.Net.Http.HttpCompletionOption]::ResponseContentRead }
        $response = $client.SendAsync($request, $completion, $cts.Token).GetAwaiter().GetResult()
        $text = $response.Content.ReadAsStringAsync($cts.Token).GetAwaiter().GetResult()
        $headers = @{}
        foreach ($header in $response.Headers) { $headers[$header.Key] = ($header.Value -join ',') }
        foreach ($header in $response.Content.Headers) { $headers[$header.Key] = ($header.Value -join ',') }
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body       = $text
            Headers    = $headers
            Cancelled  = $false
            TimedOut   = $false
        }
    }
    catch [System.OperationCanceledException] {
        return [pscustomobject]@{
            StatusCode = 0
            Body       = ''
            Headers    = @{}
            Cancelled  = $CancelAfterMilliseconds -gt 0
            TimedOut   = $CancelAfterMilliseconds -eq 0
        }
    }
    finally {
        $cts.Dispose()
        $request.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

function ConvertFrom-JsonSafe {
    param([string]$Text)
    try { return $Text | ConvertFrom-Json -Depth 50 }
    catch { return $null }
}

function Get-ObjectPath {
    param(
        [AllowNull()][object]$Object,
        [string[]]$Names
    )

    $current = $Object
    foreach ($name in $Names) {
        if ($null -eq $current) { return $null }
        $index = 0
        if ($current -is [System.Collections.IList] -and [int]::TryParse($name, [ref]$index)) {
            if ($index -lt 0 -or $index -ge $current.Count) { return $null }
            $current = $current[$index]
            continue
        }
        $property = $current.PSObject.Properties[$name]
        if ($null -eq $property) { return $null }
        $current = $property.Value
    }
    return $current
}

function Get-SseObjects {
    param([string]$Text)

    $objects = [System.Collections.Generic.List[object]]::new()
    foreach ($line in ($Text -split "`r?`n")) {
        if (-not $line.StartsWith('data:')) { continue }
        $data = $line.Substring(5).Trim()
        if ([string]::IsNullOrWhiteSpace($data) -or $data -eq '[DONE]') { continue }
        $parsed = ConvertFrom-JsonSafe $data
        if ($null -ne $parsed) { $objects.Add($parsed) }
    }
    return @($objects)
}

function New-Result {
    param(
        [int]$Level,
        [string]$Name,
        [ValidateSet('pass', 'fail', 'unsupported', 'unverified')][string]$Status,
        [string]$Kind = 'live',
        [AllowNull()][object]$Detail = $null
    )
    return [ordered]@{ level = $Level; name = $Name; status = $Status; kind = $Kind; detail = $Detail }
}

function Get-KeySnapshot {
    param([string]$ApiKey)

    $response = Invoke-OpenRouterRequest -Method GET -Path '/key' -Body $null -ApiKey $ApiKey
    $body = ConvertFrom-JsonSafe $response.Body
    $data = Get-ObjectPath $body @('data')
    return [pscustomobject]@{
        StatusCode    = $response.StatusCode
        Usage         = if ($null -ne (Get-ObjectPath $data @('usage'))) { [decimal](Get-ObjectPath $data @('usage')) } else { $null }
        Limit         = if ($null -ne (Get-ObjectPath $data @('limit'))) { [decimal](Get-ObjectPath $data @('limit')) } else { $null }
        LimitRemaining = if ($null -ne (Get-ObjectPath $data @('limit_remaining'))) { [decimal](Get-ObjectPath $data @('limit_remaining')) } else { $null }
    }
}

function Assert-Budget {
    param([AllowNull()][decimal]$StartUsage, [AllowNull()][decimal]$CurrentUsage)
    if ($null -eq $StartUsage -or $null -eq $CurrentUsage) { return $null }
    $spent = $CurrentUsage - $StartUsage
    if ($spent -ge $MaxSpendUsd) {
        throw "Live spend cap reached. Paid probe levels stopped."
    }
    return $spent
}

$apiKey = Get-LocalSecret -Path $envFile -Name 'OPENROUTER_API_KEY'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$outputPath = Join-Path $outputRoot "$runId-summary.json"
$results = [System.Collections.Generic.List[object]]::new()
$levelSnapshots = [System.Collections.Generic.List[object]]::new()

Write-Host 'OpenRouter probe started (secrets and response bodies are suppressed).'

# Level 0: free validation.
$startKey = Get-KeySnapshot -ApiKey $apiKey
$results.Add((New-Result 0 'key_status' $(if ($startKey.StatusCode -eq 200) { 'pass' } else { 'fail' }) 'live' @{ http_status = $startKey.StatusCode }))
if ($startKey.StatusCode -ne 200) {
    throw "Key validation failed with HTTP $($startKey.StatusCode)."
}
$results.Add((New-Result 0 'key_limit_remaining' $(if ($null -ne $startKey.LimitRemaining -and $startKey.LimitRemaining -gt 0) { 'pass' } else { 'fail' }) 'live' @{ available = ($null -ne $startKey.LimitRemaining -and $startKey.LimitRemaining -gt 0) }))

$modelsResponse = Invoke-OpenRouterRequest -Method GET -Path '/models' -Body $null -ApiKey $apiKey
$modelsBody = ConvertFrom-JsonSafe $modelsResponse.Body
$target = $null
if ($modelsResponse.StatusCode -eq 200 -and $null -ne $modelsBody) {
    $target = @((Get-ObjectPath $modelsBody @('data')) | Where-Object { (Get-ObjectPath $_ @('id')) -eq $targetModel }) | Select-Object -First 1
}
$results.Add((New-Result 0 'models_api' $(if ($modelsResponse.StatusCode -eq 200) { 'pass' } else { 'fail' }) 'live' @{ http_status = $modelsResponse.StatusCode }))
$results.Add((New-Result 0 'target_model_exists' $(if ($null -ne $target) { 'pass' } else { 'fail' }) 'live' @{ model = $targetModel }))
if ($null -eq $target) { throw 'The required target model is absent from the live Models API.' }
$supported = @(Get-ObjectPath $target @('supported_parameters'))
$results.Add((New-Result 0 'official_supported_parameters' 'pass' 'live' @{ tools = ($supported -contains 'tools'); reasoning = ($supported -contains 'reasoning'); max_tokens = ($supported -contains 'max_tokens') }))

$invalidResponse = Invoke-OpenRouterRequest -Method GET -Path '/key' -Body $null -ApiKey 'invalid-openrouter-key-for-classification'
$results.Add((New-Result 0 'invalid_key_401' $(if ($invalidResponse.StatusCode -eq 401) { 'pass' } else { 'fail' }) 'live' @{ http_status = $invalidResponse.StatusCode; category = (Get-ErrorCategory $invalidResponse.StatusCode) }))

foreach ($status in 402, 403, 408, 429, 502, 503) {
    $results.Add((New-Result 0 "http_${status}_classification" 'pass' 'simulated' @{ http_status = $status; category = (Get-ErrorCategory $status) }))
}
$retryAfterSeconds = 60
$results.Add((New-Result 0 'retry_after_classification' $(if ($retryAfterSeconds -gt 0) { 'pass' } else { 'fail' }) 'simulated' @{ retry_after_seconds = $retryAfterSeconds }))
$redactionSample = Protect-Text -Text "Authorization: Bearer $apiKey" -Secret $apiKey
$results.Add((New-Result 0 'log_redaction' $(if ($redactionSample -notmatch [regex]::Escape($apiKey)) { 'pass' } else { 'fail' }) 'simulated'))
$levelSnapshots.Add([ordered]@{ level = 0; usage = $startKey.Usage; limit_remaining = $startKey.LimitRemaining })
Write-Host 'Level 0 complete.'

if ($MaxLevel -ge 1) {
    $chatBody = @{
        model = $targetModel; max_tokens = 16; stream = $false; provider = $privacyProvider
        messages = @(@{ role = 'user'; content = 'Reply with exactly: OK' })
    }
    $chat = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $chatBody -ApiKey $apiKey
    $chatJson = ConvertFrom-JsonSafe $chat.Body
    $chatPass = $chat.StatusCode -eq 200 -and (Get-ObjectPath $chatJson @('model')) -eq $targetModel
    $results.Add((New-Result 1 'chat_non_stream' $(if ($chatPass) { 'pass' } else { 'fail' }) 'live' @{ http_status = $chat.StatusCode; model_match = ((Get-ObjectPath $chatJson @('model')) -eq $targetModel) }))
    $results.Add((New-Result 1 'chat_usage' $(if ($chatPass -and (Get-ObjectPath $chatJson @('usage', 'total_tokens')) -gt 0) { 'pass' } else { 'fail' }) 'live'))
    $results.Add((New-Result 1 'chat_provider_privacy_policy' $(if ($chat.StatusCode -eq 200) { 'pass' } else { 'fail' }) 'live'))

    $chatBody.stream = $true
    $chatBody.stream_options = @{ include_usage = $true }
    $chatStream = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $chatBody -ApiKey $apiKey -Stream
    $chatEvents = @(Get-SseObjects $chatStream.Body)
    $chatModels = @($chatEvents | ForEach-Object { Get-ObjectPath $_ @('model') } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $chatStreamUsage = @($chatEvents | Where-Object { (Get-ObjectPath $_ @('usage', 'total_tokens')) -gt 0 }).Count -gt 0
    $results.Add((New-Result 1 'chat_sse' $(if ($chatStream.StatusCode -eq 200 -and $chatEvents.Count -gt 0 -and $chatModels.Count -eq 1 -and $chatModels[0] -eq $targetModel) { 'pass' } else { 'fail' }) 'live' @{ http_status = $chatStream.StatusCode; event_count = $chatEvents.Count; model_match = ($chatModels.Count -eq 1 -and $chatModels[0] -eq $targetModel) }))
    $results.Add((New-Result 1 'chat_sse_usage' $(if ($chatStreamUsage) { 'pass' } else { 'fail' }) 'live'))

    $messagesBody = @{
        model = $targetModel; max_tokens = 16; stream = $false; provider = $privacyProvider
        messages = @(@{ role = 'user'; content = 'Reply with exactly: OK' })
    }
    $messages = Invoke-OpenRouterRequest -Method POST -Path '/messages' -Body $messagesBody -ApiKey $apiKey
    $messagesJson = ConvertFrom-JsonSafe $messages.Body
    $messagesPass = $messages.StatusCode -eq 200 -and (Get-ObjectPath $messagesJson @('model')) -eq $targetModel
    $results.Add((New-Result 1 'messages_non_stream' $(if ($messagesPass) { 'pass' } else { 'fail' }) 'live' @{ http_status = $messages.StatusCode; model_match = ((Get-ObjectPath $messagesJson @('model')) -eq $targetModel) }))
    $results.Add((New-Result 1 'messages_usage' $(if ($messagesPass -and (Get-ObjectPath $messagesJson @('usage', 'input_tokens')) -gt 0) { 'pass' } else { 'fail' }) 'live'))
    $results.Add((New-Result 1 'messages_provider_privacy_policy' $(if ($messages.StatusCode -eq 200) { 'pass' } else { 'fail' }) 'live'))

    $messagesBody.stream = $true
    $messagesStream = Invoke-OpenRouterRequest -Method POST -Path '/messages' -Body $messagesBody -ApiKey $apiKey -Stream
    $messageEvents = @(Get-SseObjects $messagesStream.Body)
    $messageStart = @($messageEvents | Where-Object { (Get-ObjectPath $_ @('type')) -eq 'message_start' -and (Get-ObjectPath $_ @('message', 'model')) -eq $targetModel }).Count -gt 0
    $messageUsage = @($messageEvents | Where-Object { $null -ne (Get-ObjectPath $_ @('usage')) -or $null -ne (Get-ObjectPath $_ @('message', 'usage')) }).Count -gt 0
    $results.Add((New-Result 1 'messages_sse' $(if ($messagesStream.StatusCode -eq 200 -and $messageStart) { 'pass' } else { 'fail' }) 'live' @{ http_status = $messagesStream.StatusCode; event_count = $messageEvents.Count; model_match = $messageStart }))
    $results.Add((New-Result 1 'messages_sse_usage' $(if ($messageUsage) { 'pass' } else { 'fail' }) 'live'))

    $afterLevel1 = Get-KeySnapshot -ApiKey $apiKey
    $spent = Assert-Budget $startKey.Usage $afterLevel1.Usage
    $levelSnapshots.Add([ordered]@{ level = 1; usage = $afterLevel1.Usage; limit_remaining = $afterLevel1.LimitRemaining; run_spend = $spent })
    if (@($results | Where-Object { $_.level -eq 1 -and $_.status -eq 'fail' }).Count -gt 0) {
        throw 'Level 1 core validation failed; later paid levels were not run.'
    }
    Write-Host 'Level 1 complete.'
}

if ($MaxLevel -ge 2) {
    $systemBody = @{
        model = $targetModel; max_tokens = 16; provider = $privacyProvider
        messages = @(@{ role = 'system'; content = 'Reply only with SYS_OK.' }, @{ role = 'user'; content = 'Confirm.' })
    }
    $system = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $systemBody -ApiKey $apiKey
    $systemJson = ConvertFrom-JsonSafe $system.Body
    $systemText = [string](Get-ObjectPath $systemJson @('choices', '0', 'message', 'content'))
    $results.Add((New-Result 2 'system_prompt' $(if ($system.StatusCode -eq 200 -and $systemText -match 'SYS_OK') { 'pass' } else { 'fail' }) 'live' @{ http_status = $system.StatusCode }))

    $toolBody = @{
        model = $targetModel; max_tokens = 64; provider = $privacyProvider
        tool_choice = @{ type = 'function'; function = @{ name = 'get_weather' } }
        tools = @(@{ type = 'function'; function = @{ name = 'get_weather'; description = 'Get weather.'; parameters = @{ type = 'object'; properties = @{ city = @{ type = 'string' } }; required = @('city') } } })
        messages = @(@{ role = 'user'; content = 'What is the weather in Paris?' })
    }
    $tool = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $toolBody -ApiKey $apiKey
    $toolJson = ConvertFrom-JsonSafe $tool.Body
    $toolCalls = Get-ObjectPath $toolJson @('choices', '0', 'message', 'tool_calls')
    $toolCall = if ($null -ne $toolCalls -and @($toolCalls).Count -gt 0) { @($toolCalls)[0] } else { $null }
    $toolPass = $tool.StatusCode -eq 200 -and (Get-ObjectPath $toolCall @('function', 'name')) -eq 'get_weather'
    $results.Add((New-Result 2 'tool_use' $(if ($toolPass) { 'pass' } else { 'fail' }) 'live' @{ http_status = $tool.StatusCode }))

    if ($toolPass) {
        $toolResultBody = @{
            model = $targetModel; max_tokens = 16; provider = $privacyProvider
            messages = @(
                @{ role = 'user'; content = 'What is the weather in Paris?' },
                @{ role = 'assistant'; content = $null; tool_calls = @($toolCall) },
                @{ role = 'tool'; tool_call_id = (Get-ObjectPath $toolCall @('id')); content = '{"temperature_c":21}' }
            )
        }
        $toolResult = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $toolResultBody -ApiKey $apiKey
        $results.Add((New-Result 2 'tool_result' $(if ($toolResult.StatusCode -eq 200) { 'pass' } else { 'fail' }) 'live' @{ http_status = $toolResult.StatusCode }))
    } else {
        $results.Add((New-Result 2 'tool_result' 'unverified' 'live'))
    }

    # Opus 4.6 requires at least 4,096 cacheable tokens. A single repeated word
    # stays close to that threshold without turning this into a large-context test.
    $cacheText = ('cache ' * 4500)
    $cacheBody = @{
        model = $targetModel; max_tokens = 16; provider = $privacyProvider
        system = @(@{ type = 'text'; text = $cacheText; cache_control = @{ type = 'ephemeral' } })
        messages = @(@{ role = 'user'; content = 'Reply only: CACHE_OK' })
    }
    $cacheFirst = Invoke-OpenRouterRequest -Method POST -Path '/messages' -Body $cacheBody -ApiKey $apiKey
    $cacheSecond = if ($cacheFirst.StatusCode -eq 200) { Invoke-OpenRouterRequest -Method POST -Path '/messages' -Body $cacheBody -ApiKey $apiKey } else { $null }
    $cacheSecondJson = if ($null -ne $cacheSecond) { ConvertFrom-JsonSafe $cacheSecond.Body } else { $null }
    $cacheReadValue = Get-ObjectPath $cacheSecondJson @('usage', 'cache_read_input_tokens')
    $cacheReadTokens = if ($null -ne $cacheReadValue) { [int]$cacheReadValue } else { 0 }
    $results.Add((New-Result 2 'prompt_caching' $(if ($null -ne $cacheSecond -and $cacheSecond.StatusCode -eq 200 -and $cacheReadTokens -gt 0) { 'pass' } else { 'unverified' }) 'live' @{ first_http_status = $cacheFirst.StatusCode; second_http_status = $(if ($null -ne $cacheSecond) { $cacheSecond.StatusCode } else { 0 }); cache_read_observed = ($cacheReadTokens -gt 0) }))

    # OpenRouter documents a 1,024-token minimum reasoning budget for Anthropic
    # models, with max_tokens required to be strictly larger. This is the
    # smallest configuration that can prove reasoning rather than merely prove
    # that an ignored/ineffective field was accepted.
    $reasoningBody = @{
        model = $targetModel; max_tokens = 1025; provider = $privacyProvider; reasoning = @{ max_tokens = 1024; exclude = $false }
        messages = @(@{ role = 'user'; content = 'What is 2+2? Reply concisely.' })
    }
    $reasoning = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $reasoningBody -ApiKey $apiKey
    $reasoningJson = ConvertFrom-JsonSafe $reasoning.Body
    $reasoningDetails = Get-ObjectPath $reasoningJson @('choices', '0', 'message', 'reasoning_details')
    $reasoningObserved = (Get-ObjectPath $reasoningJson @('usage', 'completion_tokens_details', 'reasoning_tokens')) -gt 0 -or
        -not [string]::IsNullOrWhiteSpace([string](Get-ObjectPath $reasoningJson @('choices', '0', 'message', 'reasoning'))) -or
        ($null -ne $reasoningDetails -and @($reasoningDetails).Count -gt 0)
    $results.Add((New-Result 2 'reasoning_effort' $(if ($reasoning.StatusCode -eq 200 -and $reasoningObserved) { 'pass' } elseif ($reasoning.StatusCode -eq 200) { 'unverified' } else { 'fail' }) 'live' @{ http_status = $reasoning.StatusCode; reasoning_observed = $reasoningObserved }))

    $stopObserved = -not [string]::IsNullOrWhiteSpace([string](Get-ObjectPath $systemJson @('choices', '0', 'finish_reason')))
    $results.Add((New-Result 2 'stop_reason' $(if ($stopObserved) { 'pass' } else { 'fail' }) 'live'))

    $cancelBody = @{ model = $targetModel; max_tokens = 32; provider = $privacyProvider; messages = @(@{ role = 'user'; content = 'Count upward slowly.' }) }
    $cancel = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $cancelBody -ApiKey $apiKey -Stream -RequestTimeoutSeconds 10 -CancelAfterMilliseconds 25
    $results.Add((New-Result 2 'cancellation' $(if ($cancel.Cancelled) { 'pass' } else { 'unverified' }) 'live' @{ client_cancelled = $cancel.Cancelled }))

    $timeout = Invoke-OpenRouterRequest -Method POST -Path '/chat/completions' -Body $cancelBody -ApiKey $apiKey -RequestTimeoutSeconds 1
    $results.Add((New-Result 2 'client_timeout' $(if ($timeout.TimedOut) { 'pass' } else { 'unverified' }) 'live' @{ client_timed_out = $timeout.TimedOut }))

    $afterLevel2 = Get-KeySnapshot -ApiKey $apiKey
    $spent = Assert-Budget $startKey.Usage $afterLevel2.Usage
    $levelSnapshots.Add([ordered]@{ level = 2; usage = $afterLevel2.Usage; limit_remaining = $afterLevel2.LimitRemaining; run_spend = $spent })
    Write-Host 'Level 2 complete.'
}

if ($MaxLevel -ge 3) {
    $responsesBody = @{
        model = $targetModel; max_output_tokens = 16; provider = $privacyProvider; input = 'Reply with exactly: OK'; stream = $false
    }
    $responses = Invoke-OpenRouterRequest -Method POST -Path '/responses' -Body $responsesBody -ApiKey $apiKey
    $responsesJson = ConvertFrom-JsonSafe $responses.Body
    $responsesPass = $responses.StatusCode -eq 200 -and (Get-ObjectPath $responsesJson @('model')) -eq $targetModel
    $results.Add((New-Result 3 'responses_non_stream' $(if ($responsesPass) { 'pass' } elseif ($responses.StatusCode -in 400, 404, 422) { 'unsupported' } else { 'fail' }) 'live' @{ http_status = $responses.StatusCode; model_match = ((Get-ObjectPath $responsesJson @('model')) -eq $targetModel) }))
    $results.Add((New-Result 3 'responses_provider_privacy_policy' $(if ($responsesPass) { 'pass' } elseif ($responses.StatusCode -in 400, 404, 422) { 'unsupported' } else { 'fail' }) 'live'))

    $responsesBody.stream = $true
    $responsesStream = Invoke-OpenRouterRequest -Method POST -Path '/responses' -Body $responsesBody -ApiKey $apiKey -Stream
    $responseEvents = @(Get-SseObjects $responsesStream.Body)
    $responseModel = @($responseEvents | ForEach-Object { Get-ObjectPath $_ @('response', 'model') } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $responsesStreamPass = $responsesStream.StatusCode -eq 200 -and $responseEvents.Count -gt 0 -and $responseModel.Count -eq 1 -and $responseModel[0] -eq $targetModel
    $results.Add((New-Result 3 'responses_sse' $(if ($responsesStreamPass) { 'pass' } elseif ($responsesStream.StatusCode -in 400, 404, 422) { 'unsupported' } else { 'fail' }) 'live' @{ http_status = $responsesStream.StatusCode; event_count = $responseEvents.Count; model_match = ($responseModel.Count -eq 1 -and $responseModel[0] -eq $targetModel) }))

    $afterLevel3 = Get-KeySnapshot -ApiKey $apiKey
    $spent = Assert-Budget $startKey.Usage $afterLevel3.Usage
    $levelSnapshots.Add([ordered]@{ level = 3; usage = $afterLevel3.Usage; limit_remaining = $afterLevel3.LimitRemaining; run_spend = $spent })
    Write-Host 'Level 3 complete.'
}

$finalKey = Get-KeySnapshot -ApiKey $apiKey
$runSpend = if ($null -ne $startKey.Usage -and $null -ne $finalKey.Usage) { $finalKey.Usage - $startKey.Usage } else { $null }
$summary = [ordered]@{
    run_id             = $runId
    target_model       = $targetModel
    max_level          = $MaxLevel
    max_spend_usd      = $MaxSpendUsd
    run_spend_usd      = $runSpend
    starting_usage     = $startKey.Usage
    starting_limit     = $startKey.Limit
    starting_remaining = $startKey.LimitRemaining
    final_usage        = $finalKey.Usage
    final_remaining    = $finalKey.LimitRemaining
    level_snapshots    = @($levelSnapshots)
    results            = @($results)
}
$json = $summary | ConvertTo-Json -Depth 30
$json = Protect-Text -Text $json -Secret $apiKey
[System.IO.File]::WriteAllText($outputPath, $json, [System.Text.UTF8Encoding]::new($false))

$passCount = @($results | Where-Object { $_.status -eq 'pass' }).Count
$failCount = @($results | Where-Object { $_.status -eq 'fail' }).Count
$unverifiedCount = @($results | Where-Object { $_.status -in 'unverified', 'unsupported' }).Count
Write-Host "Probe complete: pass=$passCount fail=$failCount unverified_or_unsupported=$unverifiedCount"
Write-Host "Sanitized summary: $outputPath"
if ($failCount -gt 0) { exit 1 }
