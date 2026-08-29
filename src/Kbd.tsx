import type { ComponentProps } from 'react'

const kbdClassName = 'inline-flex h-5 min-w-5 items-center justify-center whitespace-nowrap rounded-md bg-hover px-1 font-code text-[0.7rem] leading-none text-ink'

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={`${kbdClassName}${className ? ` ${className}` : ''}`} {...props} />
}
