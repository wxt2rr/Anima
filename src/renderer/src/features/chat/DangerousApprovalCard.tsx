import { memo } from 'react'
import { Check } from 'lucide-react'

type ApprovalOption = 'approve_once' | 'approve_thread' | 'approve_whitelist' | 'reject'

type Approval = {
  command: string
  status?: 'pending' | 'approved_once' | 'approved_thread' | 'approved_whitelist' | 'rejected'
  selectedOption?: ApprovalOption
  dismissed?: boolean
}

export const DangerousApprovalCard = memo(function DangerousApprovalCard({
  approval,
  onSelect,
  onSubmit
}: {
  approval: Approval
  onSelect: (option: ApprovalOption) => void
  onSubmit: () => void
}): JSX.Element | null {
  const command = String(approval?.command || '').trim()
  const status = String(approval?.status || 'pending')
  const selectedOption = String(approval?.selectedOption || 'approve_once') as ApprovalOption
  const disabled = status !== 'pending'
  if (!command || approval?.dismissed || status !== 'pending') return null

  const options: Array<{ id: 'approve_once' | 'approve_thread' | 'reject'; label: string }> = [
    { id: 'approve_once', label: '仅本次允许' },
    { id: 'approve_thread', label: '本线程始终允许' },
    { id: 'reject', label: '拒绝执行' }
  ]

  return (
    <div className="py-1.5">
      <div className="rounded-2xl border border-black/6 bg-white p-4 space-y-3">
        <div className="text-[14px] font-medium">检测到危险命令，是否继续？</div>
        <pre className="rounded-md border bg-muted/50 px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-all">{command}</pre>
        <div className="space-y-1">
          {options.map((option, index) => {
            const selected = selectedOption === option.id
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] ${selected ? 'bg-muted' : 'hover:bg-muted/60'} ${disabled ? 'opacity-70 cursor-default' : ''}`}
                onClick={() => onSelect(option.id)}
              >
                <span className="w-4 shrink-0 text-muted-foreground">{index + 1}.</span>
                <span className="flex-1">{option.label}</span>
                {selected ? <Check className="w-3.5 h-3.5 text-muted-foreground" /> : null}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground">等待确认</span>
          <button type="button" className="h-8 rounded-full px-4 text-sm bg-primary text-primary-foreground" disabled={disabled} onClick={onSubmit}>
            提交
          </button>
        </div>
      </div>
    </div>
  )
})
