export function AsyncStatus({ loading, message = '불러오는 중…' }: { loading?: boolean; message?: string }) { return loading ? <p className="status" role="status">{message}</p> : null; }
