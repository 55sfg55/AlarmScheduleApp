# screenLoader.js Documentation

## Overview

`screenLoader.js` provides a simple screen‑loading and rendering system for the alarm app. It defines several interactive screens (dismissal challenges) as static templates, each containing HTML markup, JavaScript initialization, and cleanup logic. Two exported functions allow other modules to load a screen definition and render it into a DOM container with a given interaction context.

---

## Exported Symbols

| Export | Type | Description |
|--------|------|-------------|
| `loadScreen` | `async function(screenId: string)` | Returns the screen definition object for the given ID, or `null` if not found. |
| `renderScreen` | `function(container, screenDef, context)` | Renders a screen definition into a DOM element and binds interactive behavior. |

---

## Screen Template Structure

Each screen is defined inside the private object `screenTemplates`. A template has three properties:

| Property | Type | Description |
|----------|------|-------------|
| `html` | `string` | HTML markup of the screen. May contain `{{disabled}}` placeholder replaced with the CSS class `'disabled'` when the context is disabled. |
| `js` | `function(container, context)` | Called after HTML injection to add event listeners and dynamic behavior. Receives the container DOM element and the context object. |
| `cleanup` | `function(container)` | Removes event listeners and resets the container’s inner HTML. Called when the screen is replaced or removed. |

All screens assume the container already has a `_cleanup` property that will be set by `renderScreen`.

---

## Available Screens

| screenId | Type | Description |
|----------|------|-------------|
| `simple-dismiss` | Button | A single “Dismiss” button. Click calls `context.onAction('button')`. Disabled state adds `disabled` class to the button. |
| `swipe-dismiss` | Drag | A swipeable track with a thumb. Swiping ≥70% triggers `context.onAction('swipe')`. Uses mouse/touch events with custom cleanup. |
| `hold-dismiss` | Hold | A button that must be held for 2 seconds. A circular SVG progress ring fills up. On completion calls `context.onAction('hold')`. Cancels on release. |
| `pattern-dismiss` | Sequence | Three dots labeled 1‑3. User must tap them in order (1 → 2 → 3). Correct sequence calls `context.onAction('pattern')`. Wrong tap resets the sequence. |
| `between-message` | Info | Static screen showing two labels (source and target) using `{{sourceLabel}}` and `{{targetLabel}}` placeholders, intended for the “between” display between chained alarms. No interaction. |

---

## Function Details

### `loadScreen(screenId)`
**Input:** `screenId: string`  
**Output:** `Object|null` – the screen definition (with `html`, `js`, `cleanup`) or `null` if the ID is not recognised.  
**Side Effects:** none (pure lookup).  
**Note:** The function is declared `async` but is currently synchronous; the async signature allows future enhancements without breaking callers.

### `renderScreen(container, screenDef, context)`
**Input:**  
- `container: HTMLElement` – the DOM element where the screen will be rendered.  
- `screenDef: Object` – a screen definition as returned by `loadScreen`.  
- `context: Object` – an interaction context with the following expected properties:

| Context Property | Type | Required | Description |
|------------------|------|----------|-------------|
| `disabled` | `boolean` | yes | If `true`, the screen should be rendered in a non‑interactive state. |
| `onAction` | `function(actionType: string)` | yes | Callback invoked when the user successfully completes the dismissal challenge. The `actionType` is the screen’s identifier (`'button'`, `'swipe'`, `'hold'`, `'pattern'`). |
| `betweenSource` | `string` | only for `between-message` | Label of the source alarm (for chained alarms). |
| `betweenTarget` | `string` | only for `between-message` | Label of the target alarm. |

**Output:** none (direct DOM manipulation).  
**Side Effects:**  
- Sets `container.innerHTML` to the screen’s HTML (with `{{disabled}}` replaced).  
- Calls `screenDef.js(container, context)` to attach behavior.  
- Assigns `container._cleanup = () => screenDef.cleanup(container)` so that the caller can later remove the screen.  
- If the screen’s JS attaches its own cleanup functions (e.g., `_swipeCleanup`, `_holdCleanup`), those are invoked by the template’s `cleanup` method before clearing the HTML.

---

## Inputs Summary

- **`loadScreen`**: a screen ID string (e.g., `'swipe-dismiss'`).  
- **`renderScreen`**: a DOM container, a screen definition object, and a context object with `disabled`, `onAction`, and optional between labels.  
- **Internal templates**: static HTML strings and JS functions that modify the container and listen to user events.

## Outputs Summary

- **`loadScreen` returns** a screen definition object or `null`.  
- **`renderScreen` modifies** the DOM container and attaches cleanup logic.  
- **Through context callbacks**, the screens ultimately notify the parent application when an action is completed.  
- **Cleanup** ensures no dangling event listeners remain when a screen is removed.