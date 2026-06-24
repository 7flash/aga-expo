import { serve } from 'tradjs';

const port = Number(process.env.PORT ?? 3000);

await serve({
  port,
  defaultTitle: 'Geeksy',
});
