/**
 * Скрипт в <head> (layout.tsx): ловит событие beforeinstallprompt, даже если браузер пришлёт его раньше,
 * чем загрузится React (дальше событие забирает initInstallEvents из src/lib/pwa/client.ts).
 * preventDefault убирает встроенную мини-панель Chrome на телефоне: вместо неё — наша кнопка и подсказка.
 */
export const installCaptureScript =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__dscInstallPrompt=e;});";
