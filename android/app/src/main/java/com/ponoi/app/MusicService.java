package com.ponoi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * v1.444.0: постоянная служба, пока играет музыка.
 *
 * Чего не было. Ponoi Music держался на одном Media Session: система показывала
 * карточку в шторке, но сам процесс приложения оставался обычным. Свернул
 * приложение, открыл пару других — и Android при нехватке памяти вправе
 * прибрать процесс. Музыка обрывалась на полуслове, и понять, почему, было
 * нельзя: приложение ничего не делало неправильно, его просто убивали.
 *
 * Что делает эта служба. Ровно одно: пока идёт воспроизведение, она держит
 * приложение в состоянии «работает на переднем плане». Для системы это значит
 * «у процесса есть видимая пользователю задача» — такие убивают в последнюю
 * очередь. Своего звука служба не проигрывает и в проигрыватель не лезет:
 * играет по-прежнему WebView, служба только не даёт его прибрать.
 *
 * Почему уведомление обязательно. Android не разрешает держать службу на
 * переднем плане молча — это защита от приложений, живущих в фоне незаметно.
 * Уведомление здесь тихое (канал минимальной важности: без звука, без всплытия)
 * и нажатие на него возвращает в приложение.
 *
 * Чего эта служба НЕ отменяет: если пользователь сам закроет приложение из
 * списка недавних, служба остановится вместе с ним — и это правильно.
 */
public class MusicService extends Service {

    public static final String CHANNEL_ID = "ponoi_music";
    public static final String ACTION_START = "com.ponoi.app.MUSIC_START";
    public static final String ACTION_STOP = "com.ponoi.app.MUSIC_STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    /** Свой номер, чтобы обновлять то же самое уведомление, а не плодить новые. */
    private static final int NOTE_ID = 4771;

    @Override
    public IBinder onBind(Intent intent) {
        // Служба не для связывания: ею управляют через startService/stopService.
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String artist = intent == null ? null : intent.getStringExtra(EXTRA_ARTIST);
        try {
            ensureChannel(this);
            startInForeground(buildNote(title, artist));
        } catch (Exception e) {
            // Не вышло — приложение обязано продолжить играть как раньше, пусть и
            // без защиты от выгрузки. Падать из-за украшения нельзя.
            stopSelf();
            return START_NOT_STICKY;
        }
        // NOT_STICKY: если систему всё же заставили нас убить, поднимать службу
        // заново без музыки незачем — получилось бы уведомление в пустоту.
        return START_NOT_STICKY;
    }

    private void startInForeground(Notification note) {
        if (Build.VERSION.SDK_INT >= 29) {
            // С Android 10 тип обязателен, с Android 14 — обязателен и разрешён
            // только заявленный в манифесте. Наш случай — воспроизведение.
            startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTE_ID, note);
        }
    }

    /** Канал минимальной важности: уведомление видно в шторке, но оно не звенит
     *  и не выскакивает поверх экрана. */
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Ponoi Music", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Пока играет музыка, приложение не выгружается из памяти");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNote(String title, String artist) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // С Android 12 у отложенного намерения обязан быть явно указан изменчивый
        // он или нет — иначе система бросает исключение прямо при создании.
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle(title == null || title.isEmpty() ? "Ponoi Music" : title);
        b.setContentText(artist == null || artist.isEmpty() ? "Воспроизведение" : artist);
        b.setSmallIcon(android.R.drawable.ic_media_play);
        b.setContentIntent(tap);
        b.setOngoing(true);
        // Уведомление служебное: настоящие кнопки плеера рисует система по данным
        // Media Session (см. src/music/mediaSession.ts). Двух наборов кнопок быть
        // не должно, поэтому здесь их нет вовсе.
        if (Build.VERSION.SDK_INT >= 21) b.setVisibility(Notification.VISIBILITY_PUBLIC);
        return b.build();
    }

    @Override
    public void onDestroy() {
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) { }
        super.onDestroy();
    }
}
