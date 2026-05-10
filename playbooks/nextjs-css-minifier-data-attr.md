# Next.js prod CSS minifier дропает `[data-attr]` префикс

Playbook: dark/light-mode (или любой `data-*` toggle) ломается **только в production**, в `next dev` всё корректно. Боевой кейс — AIMAK 2026-05-09, бэйджи категорий все одного цвета на /kz.

## Когда применять

- Тема/режим переключается через `[data-theme="dark"] .selector`
- В `next dev` стили работают корректно
- В `next build` (production) dark-mode стили **применяются всегда**, перебивают light-mode
- Или наоборот: dark/light правила вообще не работают, выглядит как «один цвет на все варианты»
- В DevTools видно что rule `.cat[data-cat=region]` существует **дважды** — без префикса родителя

## Корневая причина

Next.js 14+ использует **lightningcss** (или `cssnano`) для минификации CSS в production. При селекторах вида:

```css
[data-theme="dark"] .cat[data-cat="region"]{ color:#e5c79a }
```

минифайер может **схлопнуть** ведущий attribute-селектор `[data-theme="dark"]`, оставив:

```css
.cat[data-cat=region]{ color:#e5c79a }
```

Если такие правила идут **после** light-mode варианта (и они и есть позже — потому что dark обычно дописывается ниже), они перебивают light-mode стили **во всех режимах**.

В исходном CSS селектор корректный. В `.next/static/css/<hash>.css` префикс пропадает.

## Воспроизведение

В `apps/web/src/styles/aimaq-redesign.css` исходник был:

```css
.cat[data-cat="region"]{ background:hsla(31,53%,64%,.22); color:#8a6132 }       /* light */
[data-theme="dark"] .cat[data-cat="region"]{ color:#e5c79a; background:hsla(36,59%,75%,.18) }  /* dark */
```

После production билда в bundle:

```css
.cat[data-cat=region]{ background:hsla(31,53%,64%,.22); color:#8a6132 }
.cat[data-cat=region]{ color:#e5c79a; background:hsla(36,59%,75%,.18) }   /* префикс пропал */
```

Второе правило (с теми же селектором и большей специфичностью совпадающей) **всегда** переопределяет первое — пользователи в light-mode видели dark-mode цвета.

## Решение — element-prefix

Поднять специфичность через element + attr, чтобы минификатор не мог схлопнуть префикс:

```css
/* ❌ может потерять префикс при минификации */
[data-theme="dark"] .target{ ... }

/* ✅ element-prefix защищает от мерджа */
html[data-theme="dark"] .target{ ... }
:root[data-theme="dark"] .target{ ... }
```

Один sed-find-replace во всём CSS-файле:

```bash
sed -i 's/\[data-theme="dark"\]/html[data-theme="dark"]/g' \
  apps/web/src/styles/your-redesign.css
```

После rebuild в bundle станет:

```css
html[data-theme=dark] .cat[data-cat=region]{ ... }
```

— минификатор **не схлопывает** element-prefixed селектор, dark-mode правила применяются строго при `<html data-theme="dark">`.

## Где ещё ловится та же проблема

- `[data-state="open"] .target` — Radix-style toggle компоненты
- `[aria-expanded="true"] .target` — accordion / dropdown
- `[data-tab="active"] .target` — кастомные tabs
- любой ведущий `[attr=value]` без element-префикса

Лечится одинаково — добавить `html`, `body`, `:root`, `div`, или конкретный родительский selector перед атрибутом.

## Альтернатива — `@media (prefers-color-scheme: dark)`

Если ручной toggle темы не нужен (только OS-level):

```css
@media (prefers-color-scheme: dark){
  .target{ ... }
}
```

Минификатор `@media` не трогает. Но теряется UX-возможность дать кнопку «переключить тему».

## Связанные кейсы

- AIMAK 2026-05-09 (commit `944ae96`) — все 7 цветов категорий заработали после `s/\[data-theme="dark"\]/html[data-theme="dark"]/g`
- Та же гипотеза: специфичность 0,1,1 (`[attr] .cls`) против 0,2,1 (`html[attr] .cls`) — второе переживёт минификацию
