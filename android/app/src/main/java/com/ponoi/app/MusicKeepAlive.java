package com.ponoi.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.444.0: включатель постоянной службы для музыки (см. MusicService).
 *
 * Зачем отдельным плагином: решение «музыка идёт / музыка встала» принимает
 * веб-часть — она одна знает про очередь, паузу и то, что трек кончился. Здесь
 * только исполнение, без своей головы.
 *
 * Разрешение на уведомления. С Android 13 показ уведомлений спрашивается у
 * человека, и без него служба на переднем плане не поднимется. Мы НЕ просим его
 * при запуске приложения: спрашивать «можно уведомления?» у того, кто ещё
 * ничего не включил, — верный способ получить отказ навсегда. Просим ровно в тот
 * момент, когда человек первый раз включил музыку и свернул приложение.
 */
@CapacitorPlugin(name = "MusicKeepAlive")
public class MusicKeepAlive extends Plugin {

    /** Разрешено ли показывать уведомления (до Android 13 — всегда, если не
     *  выключено в настройках самим человеком). */
    @PluginMethod
    public void canNotify(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", allowed());
        call.resolve(ret);
    }

    private boolean allowed() {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                int st = getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS");
                if (st != PackageManager.PERMISSION_GRANTED) return false;
            }
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            return nm != null && nm.areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    /** Спросить разрешение. Системное окно показывается один раз за установку:
     *  если человек отказал, второго окна не будет — и это его право. */
    @PluginMethod
    public void requestNotify(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
                getActivity().requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7741);
            }
        } catch (Exception ignored) { }
        call.resolve();
    }

    /**
     * Показать или обновить системную карточку.
     *
     * Зовётся и при смене трека, и при паузе, и при перемотке — служба сама
     * решает, что из этого менять, а что оставить (обложку, например, она не
     * качает заново, если ссылка та же).
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (!allowed()) {
            // Врать «включил», когда служба не поднимется, нельзя: веб-часть по
            // этому ответу решает, спрашивать ли разрешение.
            JSObject ret = new JSObject();
            ret.put("value", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent i = new Intent(getContext(), MusicService.class);
            i.setAction(MusicService.ACTION_START);
            i.putExtra(MusicService.EXTRA_TITLE, call.getString("title"));
            i.putExtra(MusicService.EXTRA_ARTIST, call.getString("artist"));
            i.putExtra(MusicService.EXTRA_ALBUM, call.getString("album"));
            i.putExtra(MusicService.EXTRA_ART, call.getString("art"));
            i.putExtra(MusicService.EXTRA_PLAYING, bool(call.getBoolean("playing", Boolean.TRUE)));
            i.putExtra(MusicService.EXTRA_FOREGROUND, bool(call.getBoolean("foreground", Boolean.TRUE)));
            i.putExtra(MusicService.EXTRA_DUR, num(call.getDouble("dur")));
            i.putExtra(MusicService.EXTRA_POS, num(call.getDouble("pos")));
            MusicService.ensureChannel(getContext());
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            JSObject ret = new JSObject();
            ret.put("value", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Не подняли службу — музыка продолжит играть как раньше, просто без
            // защиты от выгрузки. Это не повод показывать ошибку человеку.
            JSObject ret = new JSObject();
            ret.put("value", false);
            call.resolve(ret);
        }
    }

    private static boolean bool(Boolean v) { return v == null || v.booleanValue(); }

    private static double num(Double v) { return v == null ? 0 : v.doubleValue(); }

    /**
     * v1.502.0: нажатия с системной карточки, наушников и экрана блокировки.
     *
     * Их принимает служба (там живёт MediaSession), а решают очередь, пауза и
     * перемотка — в веб-части. Поэтому здесь только пересылка.
     *
     * Ссылка на плагин статическая: службу поднимает система, и достучаться до
     * живого моста ей больше неоткуда. Пусто — приложение уже закрыто, и
     * пересылать некому.
     */
    private static MusicKeepAlive instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
    }

    static void sendKey(String action, double sec) {
        MusicKeepAlive p = instance;
        if (p == null || action == null) return;
        try {
            JSObject o = new JSObject();
            o.put("action", action);
            o.put("sec", sec);
            // Держим до получения: карточкой пользуются на свёрнутом приложении,
            // и в этот миг слушателя может не быть на месте.
            p.notifyListeners("mediaKey", o, true);
        } catch (Exception ignored) { }
    }

    /** Музыка встала: отпускаем процесс. Держать службу дольше нужного — это
     *  висящее уведомление и съеденная батарея. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), MusicService.class);
            i.setAction(MusicService.ACTION_STOP);
            getContext().stopService(i);
        } catch (Exception ignored) { }
        call.resolve();
    }
}
