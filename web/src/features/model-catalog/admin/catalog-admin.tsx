/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Loader2, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

import {
  archivePlatformModel,
  createPlatformModel,
  listAdminPlatformModels,
  setPlatformModelAPIEnabled,
  updatePlatformModel,
  type PlatformModelAdminInput,
} from '../api'
import { platformModelQueryKeys } from '../hooks'
import type { PlatformModelAdmin } from '../types'

const availabilityValues = [
  'available',
  'preview',
  'maintenance',
  'coming_soon',
  'disabled',
] as const
const capabilityValues = [
  'chat',
  'streaming',
  'reasoning',
  'tools',
  'json_mode',
  'structured_output',
  'vision',
  'embeddings',
  'audio',
  'image',
  'video',
] as const
const modalityValues = ['text', 'image', 'audio', 'video', 'file'] as const
const iconValues = [
  'platform',
  'sparkles',
  'brain',
  'code',
  'image',
  'audio',
  'video',
  'embedding',
] as const
const badgeValues = ['', 'preview', 'recommended', 'new'] as const

const catalogFormSchema = z.object({
  public_model_id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9._-]{1,126}[a-z0-9]$/,
      'Enter a valid public model ID'
    ),
  display_name: z.string().trim().min(1, 'Display name is required').max(128),
  provider_key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Enter a valid provider key'),
  provider_label: z
    .string()
    .trim()
    .min(1, 'Provider label is required')
    .max(128),
  description_en: z
    .string()
    .trim()
    .min(1, 'English description is required')
    .max(2000),
  description_zh_cn: z
    .string()
    .trim()
    .min(1, 'Chinese description is required')
    .max(2000),
  category: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Enter a valid category key'),
  capabilities: z
    .array(z.enum(capabilityValues))
    .min(1, 'Select at least one capability'),
  input_modalities: z
    .array(z.enum(modalityValues))
    .min(1, 'Select at least one input modality'),
  output_modalities: z
    .array(z.enum(modalityValues))
    .min(1, 'Select at least one output modality'),
  context_label: z.string().max(128),
  icon_key: z.enum(iconValues),
  badge_key: z.enum(badgeValues),
  availability_status: z.enum(availabilityValues),
  visibility: z.enum(['public', 'hidden']),
  show_in_pricing: z.boolean(),
  show_in_playground: z.boolean(),
  api_enabled: z.boolean(),
  recommended: z.boolean(),
  sort_order: z.number().int().min(0).max(1_000_000),
})

type CatalogFormValues = z.infer<typeof catalogFormSchema>

const defaultValues: CatalogFormValues = {
  public_model_id: '',
  display_name: '',
  provider_key: 'platform',
  provider_label: 'Platform routing',
  description_en: '',
  description_zh_cn: '',
  category: 'general',
  capabilities: ['chat'],
  input_modalities: ['text'],
  output_modalities: ['text'],
  context_label: '',
  icon_key: 'platform',
  badge_key: '',
  availability_status: 'preview',
  visibility: 'hidden',
  show_in_pricing: false,
  show_in_playground: false,
  api_enabled: false,
  recommended: false,
  sort_order: 100,
}

export function CatalogAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<PlatformModelAdmin | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [archiving, setArchiving] = useState<PlatformModelAdmin | null>(null)
  const query = useQuery({
    queryKey: [...platformModelQueryKeys.admin, search, status],
    queryFn: () => listAdminPlatformModels({ search, status }),
  })

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: platformModelQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: platformModelQueryKeys.admin }),
      queryClient.invalidateQueries({ queryKey: ['pricing'] }),
    ])
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      setPlatformModelAPIEnabled(id, enabled),
    onSuccess: async () => {
      await refreshAll()
      toast.success(t('Model API access updated'))
    },
    onError: () => toast.error(t('Model could not be updated')),
  })
  const archiveMutation = useMutation({
    mutationFn: archivePlatformModel,
    onSuccess: async () => {
      setArchiving(null)
      await refreshAll()
      toast.success(t('Model archived'))
    },
    onError: () => toast.error(t('Model could not be archived')),
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Search model catalog')}
          className='sm:max-w-sm'
        />
        <select
          className='border-input bg-background h-9 rounded-lg border px-3 text-sm'
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label={t('Filter by status')}
        >
          <option value=''>{t('All statuses')}</option>
          {availabilityValues.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </select>
        <Button
          className='sm:ml-auto'
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className='size-4' /> {t('Create catalog model')}
        </Button>
      </div>

      <div className='min-h-0 flex-1 rounded-xl border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Public model')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Route diagnostic')}</TableHead>
              <TableHead>{t('Pricing diagnostic')}</TableHead>
              <TableHead>{t('Surfaces')}</TableHead>
              <TableHead className='text-right'>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className='h-32 text-center'>
                  <Loader2
                    className='mx-auto size-5 animate-spin'
                    aria-label={t('Loading models')}
                  />
                </TableCell>
              </TableRow>
            )}
            {!query.isLoading && query.isError && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-destructive h-32 text-center'
                >
                  {t('Model catalog could not be loaded')}
                </TableCell>
              </TableRow>
            )}
            {!query.isLoading &&
              !query.isError &&
              query.data?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className='min-w-64 whitespace-normal'>
                    <div className='font-medium'>{entry.display_name}</div>
                    <code
                      className='text-muted-foreground text-xs break-all'
                      title={entry.public_model_id}
                    >
                      {entry.public_model_id}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div>{t(entry.availability_status)}</div>
                    <div className='text-muted-foreground text-xs'>
                      {t(entry.visibility)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Diagnostic
                      value={entry.diagnostic.route_status}
                      count={entry.diagnostic.active_route_count}
                    />
                  </TableCell>
                  <TableCell>
                    <Diagnostic value={entry.diagnostic.pricing_status} />
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    <div>{entry.show_in_pricing ? t('Pricing') : '—'}</div>
                    <div>
                      {entry.show_in_playground ? t('Playground') : '—'}
                    </div>
                    <label className='text-foreground mt-1 flex items-center gap-2'>
                      <Checkbox
                        checked={entry.api_enabled}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({
                            id: entry.id,
                            enabled: checked === true,
                          })
                        }
                      />
                      {t('API enabled')}
                    </label>
                  </TableCell>
                  <TableCell>
                    <div className='flex justify-end gap-1'>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => {
                          setEditing(entry)
                          setDialogOpen(true)
                        }}
                        aria-label={t('Edit {{modelId}}', {
                          modelId: entry.public_model_id,
                        })}
                      >
                        <Pencil className='size-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => setArchiving(entry)}
                        aria-label={t('Archive {{modelId}}', {
                          modelId: entry.public_model_id,
                        })}
                      >
                        <Archive className='size-4' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {!query.isLoading && !query.isError && !query.data?.length && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-muted-foreground h-32 text-center'
                >
                  {t('No catalog models found')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CatalogFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={refreshAll}
      />
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => {
          if (!open) setArchiving(null)
        }}
        title={t('Archive model')}
        desc={t(
          'Archive removes this model from product surfaces without deleting historical usage records.'
        )}
        destructive
        isLoading={archiveMutation.isPending}
        handleConfirm={() => {
          if (archiving) archiveMutation.mutate(archiving.id)
        }}
      />
    </div>
  )
}

function Diagnostic({ value, count }: { value: string; count?: number }) {
  const { t } = useTranslation()
  const healthy = value === 'available' || value === 'configured'
  return (
    <span className={healthy ? 'text-success' : 'text-warning-foreground'}>
      {t(value)}
      {count !== undefined ? ` · ${count}` : ''}
    </span>
  )
}

function CatalogFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: PlatformModelAdmin | null
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const form = useForm<CatalogFormValues>({
    resolver: zodResolver(catalogFormSchema),
    defaultValues,
  })
  useEffect(() => {
    if (!open) return
    form.reset(
      editing
        ? {
            public_model_id: editing.public_model_id,
            display_name: editing.display_name,
            provider_key: editing.provider_key,
            provider_label: editing.provider_label,
            description_en: editing.description_en,
            description_zh_cn: editing.description_zh_cn,
            category: editing.category,
            capabilities:
              editing.capabilities as CatalogFormValues['capabilities'],
            input_modalities:
              editing.input_modalities as CatalogFormValues['input_modalities'],
            output_modalities:
              editing.output_modalities as CatalogFormValues['output_modalities'],
            context_label: editing.context_label,
            icon_key: editing.icon_key as CatalogFormValues['icon_key'],
            badge_key: editing.badge_key as CatalogFormValues['badge_key'],
            availability_status: editing.availability_status,
            visibility: editing.visibility,
            show_in_pricing: editing.show_in_pricing,
            show_in_playground: editing.show_in_playground,
            api_enabled: editing.api_enabled,
            recommended: editing.recommended,
            sort_order: editing.sort_order,
          }
        : defaultValues
    )
  }, [editing, form, open])
  const mutation = useMutation({
    mutationFn: (values: CatalogFormValues) =>
      editing
        ? updatePlatformModel(editing.id, values as PlatformModelAdminInput)
        : createPlatformModel(values as PlatformModelAdminInput),
    onSuccess: async () => {
      await onSaved()
      onOpenChange(false)
      toast.success(
        t(editing ? 'Catalog model updated' : 'Catalog model created')
      )
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t('Model could not be saved')
      ),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {t(editing ? 'Edit catalog model' : 'Create catalog model')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Product metadata only. Routing and pricing remain managed by the gateway.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className='space-y-5'
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <TextField
                form={form}
                name='public_model_id'
                label={t('Public model ID')}
              />
              <TextField
                form={form}
                name='display_name'
                label={t('Display name')}
              />
              <TextField
                form={form}
                name='provider_key'
                label={t('Provider key')}
              />
              <TextField
                form={form}
                name='provider_label'
                label={t('Provider label')}
              />
              <TextField
                form={form}
                name='category'
                label={t('Category key')}
              />
              <FormField
                control={form.control}
                name='sort_order'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Sort order')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        max={1_000_000}
                        value={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='description_en'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('English description')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='description_zh_cn'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Chinese description')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid gap-4 sm:grid-cols-2'>
              <NativeSelect
                form={form}
                name='availability_status'
                label={t('Availability status')}
                options={availabilityValues}
              />
              <NativeSelect
                form={form}
                name='visibility'
                label={t('Visibility')}
                options={['public', 'hidden'] as const}
              />
              <NativeSelect
                form={form}
                name='icon_key'
                label={t('Icon')}
                options={iconValues}
              />
              <NativeSelect
                form={form}
                name='badge_key'
                label={t('Badge')}
                options={badgeValues}
              />
            </div>
            <TextField
              form={form}
              name='context_label'
              label={t('Context label')}
            />
            <ChoiceGroup
              form={form}
              name='capabilities'
              label={t('Capabilities')}
              options={capabilityValues}
            />
            <ChoiceGroup
              form={form}
              name='input_modalities'
              label={t('Input modalities')}
              options={modalityValues}
            />
            <ChoiceGroup
              form={form}
              name='output_modalities'
              label={t('Output modalities')}
              options={modalityValues}
            />
            <div className='grid gap-3 sm:grid-cols-2'>
              {(
                [
                  'show_in_pricing',
                  'show_in_playground',
                  'api_enabled',
                  'recommended',
                ] as const
              ).map((name) => (
                <BooleanField
                  key={name}
                  form={form}
                  name={name}
                  label={t(name)}
                />
              ))}
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type='submit' disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : null}
                {t('Save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

type FormHandle = UseFormReturn<CatalogFormValues>
function TextField({
  form,
  name,
  label,
}: {
  form: FormHandle
  name:
    | 'public_model_id'
    | 'display_name'
    | 'provider_key'
    | 'provider_label'
    | 'category'
    | 'context_label'
  label: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
function NativeSelect({
  form,
  name,
  label,
  options,
}: {
  form: FormHandle
  name: 'availability_status' | 'visibility' | 'icon_key' | 'badge_key'
  label: string
  options: readonly string[]
}) {
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <select
              className='border-input bg-background h-9 w-full rounded-lg border px-3 text-sm'
              {...field}
            >
              {options.map((option) => (
                <option key={option || 'none'} value={option}>
                  {option ? t(option) : t('None')}
                </option>
              ))}
            </select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
function ChoiceGroup({
  form,
  name,
  label,
  options,
}: {
  form: FormHandle
  name: 'capabilities' | 'input_modalities' | 'output_modalities'
  label: string
  options: readonly string[]
}) {
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className='flex flex-wrap gap-3 rounded-lg border p-3'>
            {options.map((option) => (
              <label key={option} className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={field.value.includes(option as never)}
                  onCheckedChange={(checked) =>
                    field.onChange(
                      checked
                        ? [...field.value, option]
                        : field.value.filter((value) => value !== option)
                    )
                  }
                />
                {t(option)}
              </label>
            ))}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
function BooleanField({
  form,
  name,
  label,
}: {
  form: FormHandle
  name: 'show_in_pricing' | 'show_in_playground' | 'api_enabled' | 'recommended'
  label: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className='flex items-center gap-2 rounded-lg border p-3'>
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel className='m-0'>{label}</FormLabel>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
