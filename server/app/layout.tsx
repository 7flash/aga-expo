export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#080a20" />
        <title>AGA — Voice Assistant</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
