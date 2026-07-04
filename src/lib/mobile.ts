// Мобильная поддержка (v1.34.0).
// IS_MOBILE — телефон/планшет (по user agent + сенсорный экран небольшого размера).
// Шторка навигации (рейка серверов + каналы/ЛС) на мобильных управляется классом
// body.mob-nav-open — CSS в styles.css сдвигает панели, как в мобильном Discord.
export const IS_MOBILE: boolean = (() => {
  try {
    const ua = navigator.userAgent || ''
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
    return window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820
  } catch { return false }
})()

export const DEVICE: 'mobile' | 'desktop' = IS_MOBILE ? 'mobile' : 'desktop'

export function openMobNav() { document.body.classList.add('mob-nav-open') }
export function closeMobNav() { document.body.classList.remove('mob-nav-open') }
