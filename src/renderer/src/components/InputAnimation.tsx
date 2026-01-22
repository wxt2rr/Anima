import React, { useLayoutEffect, useRef } from 'react'
import { cn } from "@/lib/utils"

interface InputAnimationProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

export const InputAnimation = React.forwardRef<HTMLTextAreaElement, InputAnimationProps>(
  ({ className, value, onChange, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement>(null)

    useLayoutEffect(() => {
      if (typeof ref === 'function') {
        ref(innerRef.current)
      } else if (ref) {
        ref.current = innerRef.current
      }
    }, [ref])

    const commonClasses = cn(
      "w-full bg-transparent resize-none focus:outline-none text-[13px] leading-relaxed text-foreground px-3 py-1 block border-0 m-0",
      className,
      "col-start-1 row-start-1"
    )

    return (
      <div className="grid w-full relative" style={{ maxHeight: '120px' }}>
        <div
          aria-hidden="true"
          className={cn(commonClasses, "invisible whitespace-pre-wrap break-words pointer-events-none overflow-hidden")}
          style={{ fontFamily: 'inherit' }}
        >
          {value + '\u200b'}
        </div>

        <textarea
          ref={innerRef}
          value={value}
          onChange={onChange}
          className={cn(commonClasses, "overflow-y-auto")}
          style={{ fontFamily: 'inherit' }}
          rows={1}
          {...props}
        />
      </div>
    )
  }
)

InputAnimation.displayName = 'InputAnimation'
