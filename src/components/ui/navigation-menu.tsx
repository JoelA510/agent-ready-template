import * as React from 'react'
import * as NavigationMenuPrimitive from '@radix-ui/react-navigation-menu'
import { cva } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

function NavigationMenu({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root>) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      className={cn('relative flex justify-center', className)}
      {...props}
    >
      {children}
      <NavigationMenuViewport />
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn('flex list-none items-center justify-center gap-1', className)}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn('relative', className)}
      {...props}
    />
  )
}

// Shared visual treatment for both Trigger and Link so a plain nav item and a
// dropdown-opening nav item read as the same kind of control — only Trigger
// gets the trailing chevron.
const navigationMenuTriggerStyle = cva(
  'inline-flex w-max items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50',
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(
        navigationMenuTriggerStyle(),
        'group data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className="relative top-px size-3 transition-transform duration-(--motion-duration-base) group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        'absolute top-0 left-0 w-full rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md md:w-auto',
        'duration-(--motion-duration-base)',
        'data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in-0',
        'data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        navigationMenuTriggerStyle(),
        // Radix emits the active link as data-active="" (empty string), so the selector
        // must be attribute-presence (`data-[active]`), not a value match — data-[active=true]
        // would never fire and the active nav item would never get its highlight.
        'data-[active]:bg-accent data-[active]:text-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div className="absolute top-full left-0 z-[var(--z-popover)] flex w-full justify-center">
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        className={cn(
          'relative mt-1.5 h-(--radix-navigation-menu-viewport-height) w-(--radix-navigation-menu-viewport-width) origin-top overflow-hidden transition-[width,height] duration-(--motion-duration-base)',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Indicator>) {
  return (
    <NavigationMenuPrimitive.Indicator
      data-slot="navigation-menu-indicator"
      className={cn(
        'top-full z-[var(--z-popover)] flex h-1.5 items-end justify-center overflow-hidden',
        'data-[state=visible]:animate-in data-[state=visible]:fade-in-0',
        'data-[state=hidden]:animate-out data-[state=hidden]:fade-out-0',
        className,
      )}
      {...props}
    >
      <div className="relative top-[60%] size-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
    </NavigationMenuPrimitive.Indicator>
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuViewport,
  NavigationMenuIndicator,
  navigationMenuTriggerStyle,
}
