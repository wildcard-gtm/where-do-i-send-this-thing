// Bare layout for postcard rendering — no nav, no sidebar
// Playwright screenshots this page to produce the final PNG
export default function PostcardRenderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#000" }}>
        {children}
      </body>
    </html>
  );
}
