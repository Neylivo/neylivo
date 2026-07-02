
import { Status, STATUS_COLOR, STATUS_LABEL } from '../lib/presence'

export function StatusDot({ status, size = 12, title }: { status: Status; size?: number; title?: boolean }) {
  return <span className="status-dot" title={title ? STATUS_LABEL[status] : undefined}
    style={{ width: size, height: size, background: STATUS_COLOR[status] }} />
}
