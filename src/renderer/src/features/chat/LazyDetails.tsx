import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function LazyDetails({ open, children }: { open: boolean; children: ReactNode }): JSX.Element | null {
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [activated, setActivated] = useState(open)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    }, { rootMargin: '240px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (open) setActivated(true)
  }, [open])

  const canRender = activated || visible
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const }
  const contentTransition = reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <div ref={ref}>
      <AnimatePresence initial={false}>
        {open && canRender ? (
          <motion.div
            key="lazy-details"
            initial={{ gridTemplateRows: '0fr' }}
            animate={{ gridTemplateRows: '1fr' }}
            exit={{ gridTemplateRows: '0fr' }}
            transition={transition}
            className="overflow-hidden"
            style={{ display: 'grid', willChange: 'grid-template-rows' }}
          >
            <motion.div
              initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 2 }}
              transition={contentTransition}
              className="min-h-0 overflow-hidden"
            >
              {children}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
