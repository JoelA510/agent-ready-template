import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from './button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form'
import { Input } from './input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select'
import { Textarea } from './textarea'

const customers = [
  { value: 'globex', label: 'Globex' },
  { value: 'initech', label: 'Initech' },
  { value: 'umbrella-corp', label: 'Umbrella Corp' },
  { value: 'stark-industries', label: 'Stark Industries' },
  { value: 'massive-dynamic', label: 'Massive Dynamic' },
] as const

const categories = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'design', label: 'Design' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'product', label: 'Product' },
  { value: 'support', label: 'Customer Support' },
] as const

const createProjectSchema = z.object({
  projectName: z
    .string()
    .min(3, 'Give the project a name of at least 3 characters.')
    .max(80, 'Project names are limited to 80 characters.'),
  customer: z.string().min(1, 'Select the customer this project belongs to.'),
  category: z.string().min(1, 'Choose a category.'),
  notes: z
    .string()
    .max(400, 'Keep notes under 400 characters.')
    .optional(),
})

type CreateProjectValues = z.infer<typeof createProjectSchema>

function CreateProjectForm() {
  const [submitted, setSubmitted] = React.useState<CreateProjectValues | null>(null)

  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      projectName: '',
      customer: '',
      category: '',
      notes: '',
    },
  })

  function onSubmit(values: CreateProjectValues) {
    setSubmitted(values)
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid w-full max-w-md gap-6"
      >
        <FormField
          control={form.control}
          name="projectName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project name</FormLabel>
              <FormControl>
                <Input placeholder="Globex — Website redesign" {...field} />
              </FormControl>
              <FormDescription>
                A short, human-readable label the team will recognize in the project list.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Customer</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Active customers</SelectLabel>
                    {customers.map((customer) => (
                      <SelectItem key={customer.value} value={customer.value}>
                        {customer.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Scope summary, key contacts, billing arrangement…"
                  {...field}
                />
              </FormControl>
              <FormDescription>Optional. Visible to the assigned team only.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3">
          <Button type="submit">Create project</Button>
          {submitted ? (
            <p className="text-sm text-success" role="status">
              Project “{submitted.projectName}” created.
            </p>
          ) : null}
        </div>
      </form>
    </Form>
  )
}

const meta = {
  title: 'Components/Form',
  component: CreateProjectForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The integration layer between react-hook-form and this system's field components (Input, Select, Textarea, Label). FormField wraps a react-hook-form Controller, and the surrounding FormItem / FormLabel / FormControl / FormDescription / FormMessage pieces wire up accessible error handling for you automatically — matching htmlFor/id, aria-describedby, and aria-invalid, and rendering the field's validation message from the resolver. Reach for it whenever a screen collects and validates structured input (creating a project, customer onboarding, billing configuration); for a single uncontrolled field with no validation, a bare Label + Input is enough.",
      },
    },
  },
} satisfies Meta<typeof CreateProjectForm>

export default meta
type Story = StoryObj<typeof meta>

export const CreateProject: Story = {
  name: 'Create project',
  render: () => <CreateProjectForm />,
}
