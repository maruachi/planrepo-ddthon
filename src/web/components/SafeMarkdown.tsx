import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export function SafeMarkdown({ children }: { readonly children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        table: ({ children }) => (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        ),
        img: ({ alt, src }) => (
          <span className="markdown-image-reference">
            이미지 참조: {alt?.trim() || src || '설명 없음'}
          </span>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
