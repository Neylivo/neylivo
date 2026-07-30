package com.ponoi.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v1.308.0: плагин обновления регистрируется ДО super.onCreate — иначе мост
        // успевает подняться без него, и вызов из интерфейса не находит адресата.
        registerPlugin(ApkInstaller.class);
        super.onCreate(savedInstanceState);
        goFullScreen();
    }

    /**
     * v1.425.0: приложение занимает весь экран целиком.
     *
     * Что было. Окно жило между системными полосами: сверху планка с часами,
     * снизу планка навигации, и обе своего цвета, не как приложение. На телефоне
     * это отнимало заметную часть экрана и выглядело как страница в браузере, а
     * не как приложение.
     *
     * Как сделано. Окно раскладывается ПОД системные полосы, а сами полосы
     * становятся прозрачными: часы и кнопки навигации остаются видны поверх
     * нашего фона. Ничего важного под ними не окажется — вся разметка считает
     * отступы через safe-area-inset (styles.css), и это было сделано раньше, но
     * до сих пор работало только в браузере: приложение отдавало вебу область
     * УЖЕ без системных полос, и отступам просто нечего было прибавлять.
     *
     * Почему сразу два способа: setDecorFitsSystemWindows появился в Android 11,
     * а setSystemUiVisibility объявлен устаревшим, но работает с пятой версии.
     * Только новым — на телефонах постарше не изменилось бы ничего.
     */
    private void goFullScreen() {
        try {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 30) {
                w.setDecorFitsSystemWindows(false);
            } else {
                w.getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            }
        } catch (Throwable ignored) {
            // Полный экран — украшение: если оболочка телефона его не позволила,
            // приложение обязано открыться как раньше, а не упасть на старте.
        }
    }
}
