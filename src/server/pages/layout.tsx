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
        <link rel="icon" href="/public/favicon.ico" sizes="any" />
        <link rel="icon" href="/public/favicon-32.png" type="image/png" />
        <link rel="apple-touch-icon" href="/public/apple-touch-icon.png" />
        <link rel="stylesheet" href="/public/styles.css" />
      </head>
      <body>
        <div class="shell">
          <header class="header">
            <a href="/" class="header-brand">
              <img src="/public/logo.png" alt="" class="header-logo" />
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

          function markRead(el) {
            var id = el.getAttribute('data-item-id');
            if (id) fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ read: true })
            });
          }

          function markReadFromCard(el) {
            var id = el.getAttribute('data-item-id');
            if (!id) return;
            var card = el.closest('.card');
            if (card) {
              card.classList.add('is-read');
              var dot = card.querySelector('.unread-dot');
              if (dot) dot.remove();
              var readBtn = card.querySelector('.card-read-btn');
              if (readBtn) {
                readBtn.setAttribute('data-read', 'true');
                readBtn.textContent = 'unread';
              }
            }
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ read: true })
            });
          }

          function toggleCardRead(btn) {
            var id = btn.getAttribute('data-item-id');
            var isRead = btn.getAttribute('data-read') === 'true';
            var newRead = !isRead;
            btn.setAttribute('data-read', String(newRead));
            btn.textContent = newRead ? 'unread' : 'read';
            var card = btn.closest('.card');
            if (card) {
              card.classList.toggle('is-read', newRead);
              var dot = card.querySelector('.unread-dot');
              if (newRead && dot) dot.remove();
              if (!newRead && !card.querySelector('.unread-dot')) {
                var title = card.querySelector('.card-title');
                if (title) {
                  var d = document.createElement('span');
                  d.className = 'unread-dot';
                  title.insertBefore(d, title.firstChild);
                }
              }
            }
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ read: newRead })
            });
          }

          function toggleRead(btn) {
            var id = btn.getAttribute('data-item-id');
            var isRead = btn.getAttribute('data-read') === 'true';
            var newRead = !isRead;
            btn.setAttribute('data-read', String(newRead));
            btn.textContent = newRead ? 'mark unread' : 'mark read';
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ read: newRead })
            });
          }

          function toggleCardFav(btn) {
            var id = btn.getAttribute('data-item-id');
            var isFav = btn.getAttribute('data-favorited') === 'true';
            var newFav = !isFav;
            btn.setAttribute('data-favorited', String(newFav));
            btn.textContent = newFav ? '\u2605' : '\u2606';
            btn.classList.toggle('is-active', newFav);
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favorited: newFav })
            });
          }

          function toggleCardPin(btn) {
            var id = btn.getAttribute('data-item-id');
            var isPinned = btn.getAttribute('data-pinned') === 'true';
            var newPinned = !isPinned;
            btn.setAttribute('data-pinned', String(newPinned));
            btn.classList.toggle('is-active', newPinned);
            btn.classList.remove('just-pinned');
            if (newPinned) {
              void btn.offsetWidth;
              btn.classList.add('just-pinned');
            }
            var card = btn.closest('.card');
            if (card) card.classList.toggle('is-pinned', newPinned);
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned: newPinned })
            });
          }

          function toggleFav(btn) {
            var id = btn.getAttribute('data-item-id');
            var isFav = btn.getAttribute('data-favorited') === 'true';
            var newFav = !isFav;
            btn.setAttribute('data-favorited', String(newFav));
            btn.textContent = newFav ? '\u2605 favorited' : '\u2606 favorite';
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favorited: newFav })
            });
          }

          function togglePin(btn) {
            var id = btn.getAttribute('data-item-id');
            var isPinned = btn.getAttribute('data-pinned') === 'true';
            var newPinned = !isPinned;
            btn.setAttribute('data-pinned', String(newPinned));
            btn.textContent = newPinned ? 'unpin' : 'pin';
            fetch('/items/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned: newPinned })
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

          (function() {
            var el = document.querySelector('.filter-options-scroll');
            if (!el) return;
            function checkFade() {
              var hasOverflow = el.scrollWidth > el.clientWidth + 2;
              var atStart = el.scrollLeft < 2;
              var atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
              el.classList.toggle('no-overflow', !hasOverflow);
              el.classList.toggle('scrolled-mid', hasOverflow && !atStart && !atEnd);
              el.classList.toggle('scrolled-end', hasOverflow && atEnd && !atStart);
            }
            el.addEventListener('scroll', checkFade, { passive: true });
            checkFade();
            setTimeout(checkFade, 100);
          })();
        `,
          }}
        />
      </body>
    </html>
  );
};
