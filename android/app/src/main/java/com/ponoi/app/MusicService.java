package com.ponoi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * v1.502.0: настоящая карточка проигрывателя — как у Spotify.
 *
 * ЧТО БЫЛО. Служба показывала обычное уведомление: название, исполнитель и
 * значок «играет». Ни обложки, ни кнопок. В комментарии тут было написано, что
 * настоящие кнопки нарисует система по данным Media Session из веб-части
 * (src/music/mediaSession.ts) — и это оказалось неверно для нашего случая.
 * navigator.mediaSession работает в БРАУЗЕРЕ, а страница у нас живёт в WebView
 * внутри приложения: системной карточки WebView не показывает вовсе. Владелец
 * прислал снимок шторки со Spotify-подобной карточкой и написал, что у нас
 * вместо неё «висящее уведомление». Так и было.
 *
 * ЧТО ТЕПЕРЬ. Служба сама держит android.media.session.MediaSession: отдаёт
 * системе название, исполнителя, обложку и позицию, а уведомление собирается
 * стилем MediaStyle и привязывается к этой сессии. Система рисует по ним свою
 * карточку — ту самую, с обложкой, полосой и кнопками, что и у любого
 * музыкального сервиса. Кнопки с карточки, с наушников и с экрана блокировки
 * приходят в обратную сторону — в веб-часть, потому что очередь, пауза и
 * перемотка живут там.
 *
 * ПОЧЕМУ ОБЛОЖКУ ГРУЗИТ СЛУЖБА, А НЕ ВЕБ-ЧАСТЬ. Обложки приходят с чужих
 * серверов (YouTube, SoundCloud), и достать их из страницы можно только
 * картинкой — fetch туда упирается в запрет чужого источника. А здесь запрета
 * нет: обычное сетевое соединение. Ссылка data: тоже понимается — ею приходят
 * обложки из файлов на устройстве.
 *
 * ЧЕГО ЭТА СЛУЖБА НЕ ДЕЛАЕТ. Своего звука не проигрывает: играет по-прежнему
 * WebView. Пока идёт воспроизведение, она вдобавок держит процесс на переднем
 * плане, чтобы Android не выгрузил его при нехватке памяти. На паузе передний
 * план отпускается, а карточка остаётся — на ней и нажимают «играть».
 *
 * НЕ ПРОВЕРЕНО НА УСТРОЙСТВЕ. У меня нет телефона под рукой: код собирается
 * (npm run test:java), но как карточка выглядит и приходят ли нажатия — знает
 * только владелец.
 */
public class MusicService extends Service {

    public static final String CHANNEL_ID = "ponoi_music";
    public static final String ACTION_START = "com.ponoi.app.MUSIC_START";
    public static final String ACTION_STOP = "com.ponoi.app.MUSIC_STOP";
    /** Нажатия с самой карточки. Их мы только пересылаем в веб-часть. */
    public static final String ACTION_KEY = "com.ponoi.app.MUSIC_KEY";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";
    public static final String EXTRA_ART = "art";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_FOREGROUND = "foreground";
    public static final String EXTRA_DUR = "dur";
    public static final String EXTRA_POS = "pos";
    public static final String EXTRA_KEY = "key";
    /** Свой номер, чтобы обновлять то же самое уведомление, а не плодить новые. */
    private static final int NOTE_ID = 4771;

    private MediaSession session;
    private final Handler main = new Handler(Looper.getMainLooper());

    private String title = "";
    private String artist = "";
    private String album = "";
    private boolean playing = false;
    private boolean foreground = false;
    private long durMs = 0;
    private long posMs = 0;

    /** Ссылка на обложку, которую УЖЕ показали, и она сама. Без этой пары
     *  картинка качалась бы заново на каждое обновление позиции. */
    private String artKey = "";
    private Bitmap art = null;
    /** Что качается прямо сейчас — чтобы не начать то же самое дважды. */
    private String artLoading = "";

    @Override
    public IBinder onBind(Intent intent) {
        // Служба не для связывания: ею управляют через startService/stopService.
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
        try {
            session = new MediaSession(this, "PonoiMusic");
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { key("play"); }
                @Override public void onPause() { key("pause"); }
                @Override public void onSkipToNext() { key("next"); }
                @Override public void onSkipToPrevious() { key("prev"); }
                @Override public void onStop() { key("stop"); }
                @Override public void onSeekTo(long pos) { seek(pos); }
            });
            if (Build.VERSION.SDK_INT < 26) {
                // До Android 8 сессия сама себя не показывает системе, пока не
                // объявит, что умеет принимать кнопки мультимедиа.
                session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            }
            session.setActive(true);
        } catch (Exception e) {
            // Без сессии карточка будет обычным уведомлением — хуже, но живее,
            // чем падение службы.
            session = null;
        }
    }

    private void key(String name) {
        MusicKeepAlive.sendKey(name, 0);
    }

    private void seek(long ms) {
        posMs = Math.max(0, ms);
        MusicKeepAlive.sendKey("seek", posMs / 1000.0);
        publish();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_KEY.equals(action)) {
            String k = intent.getStringExtra(EXTRA_KEY);
            if ("stop".equals(k)) {
                MusicKeepAlive.sendKey("stop", 0);
                stopSelf();
                return START_NOT_STICKY;
            }
            if (k != null) MusicKeepAlive.sendKey(k, 0);
            // Веб-часть в ответ пришлёт новое состояние — сама карточка
            // перерисуется тогда же. Своей головы у службы нет.
            return START_NOT_STICKY;
        }
        if (intent != null) {
            title = str(intent.getStringExtra(EXTRA_TITLE));
            artist = str(intent.getStringExtra(EXTRA_ARTIST));
            album = str(intent.getStringExtra(EXTRA_ALBUM));
            playing = intent.getBooleanExtra(EXTRA_PLAYING, true);
            foreground = intent.getBooleanExtra(EXTRA_FOREGROUND, true);
            durMs = (long) (intent.getDoubleExtra(EXTRA_DUR, 0) * 1000);
            posMs = (long) (intent.getDoubleExtra(EXTRA_POS, 0) * 1000);
            wantArt(str(intent.getStringExtra(EXTRA_ART)));
        }
        try {
            publish();
        } catch (Exception e) {
            // Не вышло — приложение обязано продолжить играть как раньше, пусть и
            // без карточки. Падать из-за украшения нельзя.
            stopSelf();
            return START_NOT_STICKY;
        }
        // NOT_STICKY: если систему всё же заставили нас убить, поднимать службу
        // заново без музыки незачем — получилось бы уведомление в пустоту.
        return START_NOT_STICKY;
    }

    private static String str(String s) { return s == null ? "" : s; }

    /**
     * Собрать и показать карточку.
     *
     * ВАЖНО про порядок: startForeground вызывается ВСЕГДА, даже когда музыка на
     * паузе. Служба поднята через startForegroundService, и Android даёт на это
     * пять секунд — иначе приложение падает с ANR. Поэтому сперва передний план,
     * и только потом, если музыка стоит, он отпускается ВМЕСТЕ С СОХРАНЕНИЕМ
     * уведомления (DETACH): карточка остаётся, память под ней не держится.
     */
    private void publish() {
        Notification note = buildNote();
        if (Build.VERSION.SDK_INT >= 29) {
            // С Android 10 тип обязателен, с Android 14 — обязателен и разрешён
            // только заявленный в манифесте. Наш случай — воспроизведение.
            startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTE_ID, note);
        }
        if (!foreground || !playing) {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH);
            else stopForeground(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTE_ID, note);
        }
    }

    /** Отдать системе то, что играет: по этому она рисует обложку и полосу. */
    private void pushSession() {
        if (session == null) return;
        try {
            MediaMetadata.Builder m = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "Ponoi Music" : title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, album.isEmpty() ? "Ponoi Music" : album)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, durMs > 0 ? durMs : -1);
            if (art != null) {
                m.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
                // Второй ключ — для экрана блокировки: часть оболочек берёт
                // обложку именно оттуда, и без него там пусто.
                m.putBitmap(MediaMetadata.METADATA_KEY_ART, art);
            }
            session.setMetadata(m.build());

            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                    | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO;
            // Скорость 1 у играющего и 0 у стоящего — по ней система САМА
            // двигает полосу между нашими сообщениями. С нулём у играющего
            // полоса стояла бы на месте до следующего обновления.
            session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(actions)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                            posMs, playing ? 1f : 0f)
                    .build());
            session.setActive(true);
        } catch (Exception ignored) { }
    }

    private Notification buildNote() {
        pushSession();

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, piFlags(false));

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle(title.isEmpty() ? "Ponoi Music" : title);
        b.setContentText(artist.isEmpty() ? "Ponoi Music" : artist);
        if (!album.isEmpty() && Build.VERSION.SDK_INT >= 24) b.setSubText(album);
        b.setSmallIcon(android.R.drawable.ic_media_play);
        b.setContentIntent(tap);
        b.setDeleteIntent(keyIntent("stop"));
        // На паузе карточку разрешено смахнуть — так у всех, и человек не должен
        // искать, чем убрать музыку, которой уже нет.
        b.setOngoing(playing);
        b.setShowWhen(false);
        if (art != null) b.setLargeIcon(art);
        if (Build.VERSION.SDK_INT >= 21) b.setVisibility(Notification.VISIBILITY_PUBLIC);

        b.addAction(action(android.R.drawable.ic_media_previous, "Назад", "prev"));
        b.addAction(playing
                ? action(android.R.drawable.ic_media_pause, "Пауза", "pause")
                : action(android.R.drawable.ic_media_play, "Играть", "play"));
        b.addAction(action(android.R.drawable.ic_media_next, "Вперёд", "next"));

        if (session != null && Build.VERSION.SDK_INT >= 21) {
            try {
                Notification.MediaStyle st = new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        // Какие из кнопок видны, когда карточка свёрнута в строку.
                        .setShowActionsInCompactView(0, 1, 2);
                b.setStyle(st);
            } catch (Exception ignored) { }
        }
        return b.build();
    }

    private int piFlags(boolean mutable) {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        // С Android 12 у отложенного намерения обязано быть явно указано,
        // изменчивое оно или нет — иначе система бросает исключение прямо при
        // создании.
        if (Build.VERSION.SDK_INT >= 31) f |= mutable ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    /** Намерение «нажали такую-то кнопку карточки». */
    private PendingIntent keyIntent(String name) {
        Intent i = new Intent(this, MusicService.class);
        i.setAction(ACTION_KEY);
        i.putExtra(EXTRA_KEY, name);
        // Разные кнопки — разные requestCode: с одинаковым система переиспользует
        // первое намерение, и все кнопки делали бы одно и то же.
        return PendingIntent.getService(this, name.hashCode(), i, piFlags(false));
    }

    private Notification.Action action(int icon, String label, String name) {
        return new Notification.Action.Builder(icon, label, keyIntent(name)).build();
    }

    /**
     * Обложка. Уже показанную не трогаем, новую качаем в стороне от главного
     * потока и, когда придёт, пересобираем карточку.
     */
    private void wantArt(String src) {
        if (src.isEmpty()) { artKey = ""; art = null; return; }
        if (src.equals(artKey) || src.equals(artLoading)) return;
        artLoading = src;
        final String want = src;
        new Thread(new Runnable() {
            @Override public void run() {
                final Bitmap bm = loadArt(want);
                main.post(new Runnable() {
                    @Override public void run() {
                        if (!want.equals(artLoading)) return;   // трек уже сменился
                        artLoading = "";
                        if (bm == null) return;
                        art = bm;
                        artKey = want;
                        try { publish(); } catch (Exception ignored) { }
                    }
                });
            }
        }).start();
    }

    private Bitmap loadArt(String src) {
        try {
            if (src.startsWith("data:")) {
                int c = src.indexOf(',');
                if (c < 0) return null;
                byte[] raw = Base64.decode(src.substring(c + 1), Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(raw, 0, raw.length);
            }
            if (!src.startsWith("http")) return null;
            HttpURLConnection cn = (HttpURLConnection) new URL(src).openConnection();
            cn.setConnectTimeout(8000);
            cn.setReadTimeout(8000);
            cn.setInstanceFollowRedirects(true);
            InputStream in = cn.getInputStream();
            try {
                return BitmapFactory.decodeStream(in);
            } finally {
                try { in.close(); } catch (Exception ignored) { }
                cn.disconnect();
            }
        } catch (Exception e) {
            // Нет обложки — не беда: карточка будет со значком приложения.
            return null;
        }
    }

    /** Канал минимальной важности: карточка видна в шторке, но не звенит и не
     *  выскакивает поверх экрана. */
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Ponoi Music", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Карточка проигрывателя, пока в Ponoi Music есть трек");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    @Override
    public void onDestroy() {
        try {
            if (session != null) { session.setActive(false); session.release(); }
        } catch (Exception ignored) { }
        session = null;
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) { }
        super.onDestroy();
    }
}
