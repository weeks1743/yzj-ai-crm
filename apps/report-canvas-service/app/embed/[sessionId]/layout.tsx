export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, overflow: "hidden", height: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
