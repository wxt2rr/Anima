import { CheckCircle2, Circle, Loader2, XCircle, ListTodo } from 'lucide-react'
import { TodoItem } from '../store/useStore'
import { useStore } from '../store/useStore'
import { i18nText, resolveAppLang } from '@/i18n'

export function TodoProgressCard({ todos }: { todos: TodoItem[] }) {
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  if (!todos || todos.length === 0) return null

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const totalCount = todos.length
  const progress = Math.round((completedCount / totalCount) * 100)

  return (
    <div className="mb-3 rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
        <ListTodo className="w-4 h-4 text-primary" />
        <span className="text-xs font-medium text-foreground">{i18nText(lang, 'todo.progress')}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {completedCount} / {totalCount} ({progress}%)
        </span>
      </div>
      <div className="p-2 space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group">
            <div className="mt-0.5 shrink-0">
              {todo.status === 'completed' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : todo.status === 'in_progress' ? (
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              ) : todo.status === 'failed' ? (
                <XCircle className="w-3.5 h-3.5 text-red-500" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
              )}
            </div>
            <span
              className={`text-xs leading-relaxed ${
                todo.status === 'completed'
                  ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                  : 'text-foreground'
              }`}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
