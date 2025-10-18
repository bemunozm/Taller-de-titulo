/**
 * TODO: Update this component to use your client-side framework's link
 * component. We've provided examples of how to do this for Next.js, Remix, and
 * Inertia.js in the Catalyst documentation:
 *
 * https://catalyst.tailwindui.com/docs#client-side-router-integration
 */

import * as Headless from '@headlessui/react'
import {
  Link as RouterLink,
  type LinkProps as RouterLinkProps,
} from 'react-router-dom'
import React, { forwardRef } from 'react'

type Props = (RouterLinkProps & React.ComponentPropsWithoutRef<'a'>) | ({ href: string } & React.ComponentPropsWithoutRef<'a'>)

export const Link = forwardRef(function Link(
  props: Props,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  // Allow passing `href` (legacy) or `to` (react-router). Prefer href when present.
  const anyProps = props as any
  const to = anyProps.href ?? anyProps.to ?? '#'

  // Build props for RouterLink: copy all but remove href
  const { href, ...rest } = anyProps

  return (
    <Headless.DataInteractive>
      <RouterLink {...(rest as RouterLinkProps)} to={to} ref={ref} />
    </Headless.DataInteractive>
  )
})
