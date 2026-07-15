// Bare layout for iframe embeds — no site chrome.
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-plane p-4">{children}</div>
}
