import 'katex/dist/katex.min.css'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { MarkdownCompileResult } from './types'
import { compileMarkdown } from './markdownCompiler'
import { readMarkdownCompileCacheResult } from './markdownCompileCache'
import { CodeBlockView } from './CodeBlockView'
import { hydrateMarkdownHtml } from './chatLinks'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { CHAT_BODY_TEXT_CLASS, CHAT_FONT_FAMILY } from './chatPresentation'

export const MarkdownContent = memo(function MarkdownContent({
  messageId,
  content,
  streaming,
  collapseCodeBlocksByDefault,
  compact,
  bodyClassName,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir
}: {
  messageId: string
  content: string
  streaming?: boolean
  collapseCodeBlocksByDefault?: boolean
  compact?: boolean
  bodyClassName?: string
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
}): JSX.Element {
  const cachedCompiled = useMemo(
    () => readMarkdownCompileCacheResult(messageId, content),
    [messageId, content]
  )
  const [compiled, setCompiled] = useState<MarkdownCompileResult | null>(() => cachedCompiled)
  const latestRequestSeqRef = useRef(0)
  const lastAppliedSeqRef = useRef(0)
  const throttleTimerRef = useRef<number | null>(null)
  const lastMessageIdRef = useRef(messageId)
  const [skeletonVisible, setSkeletonVisible] = useState(false)
  const skeletonEnterRafRef = useRef<number | null>(null)
  const skeletonExitTimerRef = useRef<number | null>(null)
  const skeletonVisibleRef = useRef(false)
  const compiledRef = useRef<MarkdownCompileResult | null>(compiled)

  useEffect(() => {
    skeletonVisibleRef.current = skeletonVisible
  }, [skeletonVisible])

  useEffect(() => {
    compiledRef.current = compiled
  }, [compiled])

  useEffect(() => {
    let alive = true
    const startSkeleton = () => {
      if (streaming) {
        setSkeletonVisible(false)
        return
      }
      setSkeletonVisible(false)
      if (skeletonEnterRafRef.current != null) window.cancelAnimationFrame(skeletonEnterRafRef.current)
      skeletonEnterRafRef.current = window.requestAnimationFrame(() => {
        skeletonEnterRafRef.current = null
        if (!alive) return
        setSkeletonVisible(true)
      })
    }
    const messageIdChanged = lastMessageIdRef.current !== messageId
    if (messageIdChanged) {
      lastMessageIdRef.current = messageId
      setCompiled(cachedCompiled)
      if (cachedCompiled) {
        setSkeletonVisible(false)
      } else {
        startSkeleton()
      }
    } else if (cachedCompiled) {
      setCompiled(cachedCompiled)
      setSkeletonVisible(false)
    }
    const requestSeq = latestRequestSeqRef.current + 1
    latestRequestSeqRef.current = requestSeq
    const runCompile = () => {
      void compileMarkdown(messageId, content).then((next) => {
        if (!alive) return
        if (requestSeq < lastAppliedSeqRef.current) return
        const applyCompiled = () => {
          if (!alive) return
          lastAppliedSeqRef.current = requestSeq
          setCompiled(next)
        }
        if (!streaming && !compiledRef.current && skeletonVisibleRef.current) {
          setSkeletonVisible(false)
          if (skeletonExitTimerRef.current != null) window.clearTimeout(skeletonExitTimerRef.current)
          skeletonExitTimerRef.current = window.setTimeout(() => {
            skeletonExitTimerRef.current = null
            applyCompiled()
          }, 140)
          return
        }
        applyCompiled()
      }).catch(() => {
        // 编译失败时保留上一版渲染结果，避免流式阶段回退为纯文本导致闪烁。
      })
    }
    if (streaming) {
      if (throttleTimerRef.current != null) window.clearTimeout(throttleTimerRef.current)
      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null
        runCompile()
      }, 100)
    } else {
      runCompile()
    }
    return () => {
      alive = false
      if (throttleTimerRef.current != null) {
        window.clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
      if (skeletonEnterRafRef.current != null) {
        window.cancelAnimationFrame(skeletonEnterRafRef.current)
        skeletonEnterRafRef.current = null
      }
      if (skeletonExitTimerRef.current != null) {
        window.clearTimeout(skeletonExitTimerRef.current)
        skeletonExitTimerRef.current = null
      }
    }
  }, [cachedCompiled, messageId, content, streaming])

  const htmlBlocks = useMemo(
    () => compiled?.blocks.map((block) => (block.type === 'markdown' ? hydrateMarkdownHtml(block.html, { backendBaseUrl, workspaceDir }) : '')) || [],
    [compiled?.blocks, backendBaseUrl, workspaceDir]
  )

  if (!compiled) {
    if (!streaming) {
      const skeletonLineClass = compact ? 'h-[10px]' : 'h-[12px]'
      return (
        <div
          aria-hidden="true"
          className={`select-none pointer-events-none transition-[opacity,transform] duration-140 ease-out motion-reduce:transition-none ${
            skeletonVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          } ${compact ? 'space-y-1.5 py-0.5' : 'space-y-2 py-1'}`}
          style={{ fontFamily: CHAT_FONT_FAMILY }}
        >
          <div className={`${skeletonLineClass} w-[86%] rounded bg-foreground/10 motion-safe:animate-pulse`} />
          <div className={`${skeletonLineClass} w-[72%] rounded bg-foreground/10 motion-safe:animate-pulse`} />
          <div className={`${skeletonLineClass} w-[54%] rounded bg-foreground/10 motion-safe:animate-pulse`} />
        </div>
      )
    }
    return (
      <p
        className={`whitespace-pre-wrap ${compact ? 'text-[12px] leading-[18px] font-normal text-foreground/85' : bodyClassName || CHAT_BODY_TEXT_CLASS}`}
        style={{ fontFamily: CHAT_FONT_FAMILY }}
      >
        {content}
      </p>
    )
  }

  const densityClass = compact
    ? 'text-[12px] leading-[18px] font-normal text-foreground/85 prose-p:my-0 prose-p:text-[12px] prose-p:leading-[18px] prose-headings:my-0 prose-headings:text-[12px] prose-headings:font-medium prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-[12px] prose-li:leading-[18px] prose-pre:my-0 prose-blockquote:my-2 prose-strong:font-medium'
    : `${bodyClassName || CHAT_BODY_TEXT_CLASS} prose-p:my-0 prose-p:text-[13px] prose-p:leading-[22px] prose-headings:my-0 prose-headings:text-[13px] prose-headings:font-medium prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-li:text-[13px] prose-li:leading-[22px] prose-pre:my-0 prose-blockquote:my-3 prose-strong:font-medium`

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none ${densityClass} [&_.anima-chat-link]:text-blue-600 [&_.anima-chat-link]:underline [&_.anima-chat-link]:underline-offset-2 hover:[&_.anima-chat-link]:text-blue-700 dark:[&_.anima-chat-link]:text-blue-400 dark:hover:[&_.anima-chat-link]:text-blue-300 [&_.anima-chat-inline-file]:rounded [&_.anima-chat-inline-file]:bg-muted [&_.anima-chat-inline-file]:px-1.5 [&_.anima-chat-inline-file]:py-0.5 [&_.anima-chat-inline-file]:text-[12px] [&_.anima-chat-inline-file]:text-blue-600 [&_.anima-chat-inline-file]:underline [&_.anima-chat-inline-file]:underline-offset-2 [&_.anima-chat-inline-image]:max-h-72 [&_.anima-chat-inline-image]:rounded-md [&_.anima-chat-inline-image]:border [&_.anima-chat-inline-image]:border-border/60`}
      style={{ fontFamily: CHAT_FONT_FAMILY }}
      onClick={(event) => {
        const targetEl = (event.target as HTMLElement | null)?.closest?.('[data-chat-link-target]') as HTMLElement | null
        const target = String(targetEl?.getAttribute('data-chat-link-target') || '').trim()
        if (!target || !onOpenLinkTarget) return
        event.preventDefault()
        event.stopPropagation()
        onOpenLinkTarget(target)
      }}
    >
      {compiled.blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <div key={block.id} className={index === 0 ? '' : compact ? 'mt-2' : 'mt-3'}>
              <CodeBlockView language={block.language} value={block.value} defaultCollapsed={collapseCodeBlocksByDefault} />
            </div>
          )
        }
        if (block.type === 'mermaid') {
          return (
            <div key={block.id} className={index === 0 ? '' : compact ? 'mt-2' : 'mt-3'}>
              <MermaidBlock chart={block.value} />
            </div>
          )
        }
        return <div key={`md-${index}`} className={index === 0 ? '' : compact ? 'mt-2' : 'mt-3'} dangerouslySetInnerHTML={{ __html: htmlBlocks[index] || block.html }} />
      })}
    </div>
  )
})
