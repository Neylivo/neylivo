package com.ponoi.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.556.0: приложение не попадает в снимки и записи экрана.
 *
 * Владелец: «сделай чтобы приложение нельзя вообще никак сфоткать».
 *
 * Что здесь делается. Окну ставится FLAG_SECURE — после этого система сама
 * отказывается отдавать его содержимое: снимок экрана не делается вовсе
 * («Запрещено приложением или организацией»), запись экрана и трансляция видят
 * на месте приложения чёрное, и в списке недавних задач вместо переписки
 * пустая карточка. Это отказ Android, а не наша заслонка поверх картинки, —
 * обойти его нельзя, не имея прав системы.
 *
 * ЧЕГО ЭТО НЕ ДЕЛАЕТ. Съёмку экрана другим телефоном не закрывает ничто: с
 * экрана идёт свет, и он одинаково попадает и в глаз, и в чужую камеру.
 * Против съёмки со стороны в приложении есть отдельная мера — «Скрывать
 * сообщения», которая не показывает текст, пока на него не смотрят.
 *
 * Почему выбор ещё и в SharedPreferences. Флаг обязан стоять с ПЕРВОГО кадра:
 * поставленный после того, как мост поднялся и страница загрузилась, он
 * оставляет открытыми первые секунды — ровно те, что попадают в начало записи.
 * Поэтому MainActivity читает его сам, до super.onCreate, а плагин лишь
 * переключает и запоминает.
 */
@CapacitorPlugin(name = "CaptureGuard")
public class CaptureGuard extends Plugin {

    static final String PREFS = "ponoi";
    static final String KEY = "captureGuard";

    /** Стоит ли защита. По умолчанию ДА — прямая просьба владельца. */
    static boolean enabled(Context c) {
        try {
            SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return p.getBoolean(KEY, true);
        } catch (Throwable ignored) {
            return true;
        }
    }

    /** Поставить или снять флаг окна. Только из потока интерфейса. */
    static void apply(final android.app.Activity a, final boolean on) {
        try {
            if (on) {
                a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
        } catch (Throwable ignored) {
            // Защита — не то, ради чего приложение должно падать на старте.
        }
    }

    @PluginMethod
    public void set(final PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", Boolean.TRUE));
        final android.app.Activity a = getActivity();
        if (a == null) { call.reject("нет окна"); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                apply(a, on);
                try {
                    a.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .edit().putBoolean(KEY, on).apply();
                } catch (Throwable ignored) { }
                JSObject r = new JSObject();
                // Отвечаем ПОСЛЕ применения, а не до: иначе интерфейс отметил бы
                // галочку раньше, чем система что-то сделала, и при отказе
                // человек видел бы включённой защиту, которой нет.
                r.put("on", on);
                call.resolve(r);
            }
        });
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", enabled(getContext()));
        call.resolve(r);
    }
}
