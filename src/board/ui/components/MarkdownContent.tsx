import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
  className?: string;
  testId?: string;
}

const EXTERNAL_HREF = /^(?:https?:)?\/\//i;

const components: Components = {
  a({ node: _node, href, children, ...props }) {
    const external = typeof href === 'string' && EXTERNAL_HREF.test(href);
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
  table({ node: _node, children, ...props }) {
    return (
      <div className="markdown-table-wrap">
        <table {...props}>{children}</table>
      </div>
    );
  },
  img({ node: _node, alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        className="max-w-full rounded-md border border-slate-200"
      />
    );
  },
};

export function MarkdownContent({
  content,
  className,
  testId = 'markdown-content',
}: MarkdownContentProps): ReactNode {
  return (
    <div
      className={className ? `markdown-body ${className}` : 'markdown-body'}
      data-testid={testId}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
