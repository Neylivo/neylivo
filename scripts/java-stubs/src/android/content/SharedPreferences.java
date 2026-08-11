package android.content;
// v1.556.0: нужен CaptureGuard — выбор «не отдавать окно снимкам» обязан
// пережить перезапуск и быть прочитан ДО super.onCreate, то есть раньше, чем
// поднимется мост Capacitor и станет доступно хранилище веб-части.
public interface SharedPreferences {
  boolean getBoolean(String key, boolean defValue);
  Editor edit();
  interface Editor {
    Editor putBoolean(String key, boolean value);
    void apply();
    boolean commit();
  }
}
