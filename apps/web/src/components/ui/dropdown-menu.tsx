// Adapted from GodUI: https://godui.design/r/dropdown-menu.json
// Keeps Radix behavior and transform/opacity motion; uses the project's plain CSS.
import type { ComponentProps } from 'react'
import * as Primitive from '@radix-ui/react-dropdown-menu'
import './godui.css'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger

export function DropdownMenuContent({ className = '', sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset}
    collisionPadding={12} className={`godui-menu ${className}`} {...props} /></Primitive.Portal>
}

export function DropdownMenuItem({ className = '', variant = 'default', ...props }: ComponentProps<typeof Primitive.Item> & { variant?: 'default' | 'destructive' }) {
  return <Primitive.Item data-slot="dropdown-menu-item" data-variant={variant} className={`godui-menu-item ${className}`} {...props} />
}

export function DropdownMenuLabel(props: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label data-slot="dropdown-menu-label" className="godui-menu-label" {...props} />
}

export function DropdownMenuSeparator(props: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator data-slot="dropdown-menu-separator" className="godui-menu-separator" {...props} />
}
