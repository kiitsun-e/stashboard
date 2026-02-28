import type { FC } from "hono/jsx";

export const LoginPage: FC<{ error?: string }> = ({ error }) => {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login — Stashboard</title>
        <link rel="icon" href="/public/favicon.ico" sizes="any" />
        <link rel="icon" href="/public/favicon-32.png" type="image/png" />
        <link rel="apple-touch-icon" href="/public/apple-touch-icon.png" />
        <link rel="stylesheet" href="/public/styles.css" />
      </head>
      <body>
        <div class="login-shell">
          <form method="POST" action="/login" class="login-form">
            <img src="/public/logo.png" alt="" class="login-logo" />
            <h1 class="login-title">Stashboard</h1>
            {error && <p class="login-error">{error}</p>}
            <input
              type="password"
              name="token"
              placeholder="Token"
              autofocus
              required
              class="login-input"
            />
            <button type="submit" class="login-btn">Enter</button>
          </form>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          (function() {
            var saved = localStorage.getItem('stashboard-theme');
            if (saved) document.documentElement.setAttribute('data-theme', saved);
          })();
        `,
          }}
        />
      </body>
    </html>
  );
};
