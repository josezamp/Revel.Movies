// Adapted from GodUI: https://godui.design/r/switch.json
// The thumb translates and the checked track crossfades, with reduced-motion support.
import type { ComponentProps } from 'react'
import * as Primitive from '@radix-ui/react-switch'
import './godui.css'

export function Switch({ className = '', ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="switch" className={`godui-switch ${className}`} {...props}>
    <Primitive.Thumb data-slot="switch-thumb" className="godui-switch-thumb" />
  </Primitive.Root>
}
