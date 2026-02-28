import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<
  PropsWithChildren<{ title?: string; activePage?: string }>
> = ({ children, title, activePage }) => {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} — Stashboard` : "Stashboard"}</title>
        <link rel="stylesheet" href="/public/styles.css" />
      </head>
      <body>
        <div class="shell">
          <header class="header">
            <a href="/" style={{ textDecoration: "none" }}>
              <h1 class="header-title">Stashboard</h1>
            </a>
            <nav class="header-nav">
              <a href="/" class={activePage === "search" ? "active" : ""}>
                Search
              </a>
              <a
                href="/library"
                class={activePage === "library" ? "active" : ""}
              >
                Library
              </a>
              <button
                class="theme-toggle"
                onclick="toggleTheme()"
                type="button"
              >
                theme
              </button>
            </nav>
          </header>
          {children}
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          function toggleTheme() {
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('stashboard-theme', next);
          }
          (function() {
            const saved = localStorage.getItem('stashboard-theme');
            if (saved) document.documentElement.setAttribute('data-theme', saved);
          })();

          function handleItemDelete(btn) {
            if (!btn.classList.contains('confirming')) {
              btn.classList.add('confirming');
              btn.textContent = 'confirm delete?';
              setTimeout(function() {
                if (btn.classList.contains('confirming')) {
                  btn.classList.remove('confirming');
                  btn.textContent = 'delete';
                }
              }, 3000);
              return;
            }
            var id = btn.getAttribute('data-item-id');
            btn.disabled = true;
            btn.textContent = 'deleting...';
            fetch('/items/' + id, { method: 'DELETE' })
              .then(function(res) {
                if (!res.ok) throw new Error('Failed');
                window.location.href = '/library';
              })
              .catch(function() {
                btn.disabled = false;
                btn.classList.remove('confirming');
                btn.textContent = 'failed';
                setTimeout(function() { btn.textContent = 'delete'; }, 2000);
              });
          }

          function handleDelete(btn) {
            if (!btn.classList.contains('confirming')) {
              btn.classList.add('confirming');
              btn.textContent = 'confirm?';
              setTimeout(function() {
                if (btn.classList.contains('confirming')) {
                  btn.classList.remove('confirming');
                  btn.textContent = 'delete';
                }
              }, 3000);
              return;
            }
            var id = btn.getAttribute('data-item-id');
            btn.disabled = true;
            btn.textContent = '...';
            fetch('/items/' + id, { method: 'DELETE' })
              .then(function(res) {
                if (!res.ok) throw new Error('Failed');
                var card = btn.closest('.card');
                card.classList.add('deleting');
                setTimeout(function() { card.remove(); }, 200);
              })
              .catch(function() {
                btn.disabled = false;
                btn.classList.remove('confirming');
                btn.textContent = 'failed';
                setTimeout(function() { btn.textContent = 'delete'; }, 2000);
              });
          }
        `,
          }}
        />
      </body>
    </html>
  );
};
