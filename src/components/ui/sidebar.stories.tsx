import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  BarChart3,
  Briefcase,
  ChevronsUpDown,
  LayoutDashboard,
  Plus,
  Receipt,
  Scale,
  Search,
  Users,
} from 'lucide-react'

import { Separator } from './separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from './sidebar'

const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The persistent app-shell navigation for the Acme admin dashboard. Sidebar is a compound component: a SidebarProvider owns the expanded/collapsed state (persisted to a cookie, toggled with ⌘/Ctrl-B), a Sidebar renders a fixed rail on desktop and a Sheet-based drawer on mobile, and SidebarInset holds the page content beside it. Reach for Sidebar for the primary, always-present product navigation — it is distinct from NavigationMenu (a horizontal menu bar for marketing or top-level site nav) and from Sheet (a transient side panel you open for a single task and dismiss). Compose it from SidebarHeader/Content/Footer plus SidebarGroup and SidebarMenu items.',
      },
    },
  },
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                <Scale className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-serif text-sm font-semibold">Acme Inc.</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Workspace
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput placeholder="Search projects and customers" aria-label="Search" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupAction title="Add project">
            <Plus />
            <span className="sr-only">Add project</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Projects">
                  <Briefcase />
                  <span>Projects</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>128</SidebarMenuBadge>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#" isActive>
                      Active
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#">Planning</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#">On hold</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#">Completed</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Customers">
                  <Users />
                  <span>Customers</span>
                </SidebarMenuButton>
                <SidebarMenuAction>
                  <Plus />
                  <span className="sr-only">Add customer</span>
                </SidebarMenuAction>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Billing">
                  <Receipt />
                  <span>Billing</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>6</SidebarMenuBadge>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Reports">
                  <BarChart3 />
                  <span>Reports</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Teams</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Engineering">
                  <span>Engineering</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Sales">
                  <span>Sales</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Support">
                  <span>Support</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                JL
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">Jordan Lee</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Owner
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

function PageContent() {
  return (
    <>
      <header className="flex h-14 items-center gap-2 border-b border-border px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <h1 className="font-serif text-lg font-semibold">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="size-4" />
          <span>Q3 2026</span>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Active users</p>
            <p className="mt-1 font-serif text-2xl font-semibold">8,120</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Open projects</p>
            <p className="mt-1 font-serif text-2xl font-semibold">128</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Revenue</p>
            <p className="mt-1 font-serif text-2xl font-semibold">$1.2M</p>
          </div>
        </div>
        <div className="min-h-64 flex-1 rounded-lg border border-dashed border-border bg-muted/40" />
      </div>
    </>
  )
}

export const Default: Story = {
  render: () => (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <PageContent />
      </SidebarInset>
    </SidebarProvider>
  ),
}

export const Collapsible: Story = {
  name: 'Collapsible (icon rail)',
  parameters: {
    docs: {
      description: {
        story:
          'With `collapsible="icon"`, toggling the rail (⌘/Ctrl-B or the SidebarTrigger) shrinks it to an icon-only strip. Each SidebarMenuButton carries a `tooltip`, which surfaces the label on hover only while collapsed so the nav stays legible without its text.',
      },
    },
  },
  render: () => (
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Acme Inc.">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <Scale className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-serif text-sm font-semibold">
                    Acme Inc.
                  </span>
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    Workspace
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive tooltip="Dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Projects">
                    <Briefcase />
                    <span>Projects</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Customers">
                    <Users />
                    <span>Customers</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Billing">
                    <Receipt />
                    <span>Billing</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Reports">
                    <BarChart3 />
                    <span>Reports</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <PageContent />
      </SidebarInset>
    </SidebarProvider>
  ),
}
