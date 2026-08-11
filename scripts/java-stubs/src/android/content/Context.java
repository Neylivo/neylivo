package android.content;
import android.content.pm.PackageManager;
public abstract class Context {
  public static final String CONNECTIVITY_SERVICE = "connectivity";
  public static final String NOTIFICATION_SERVICE = "notification";
  // Режим хранилища настроек: файл виден только самому приложению.
  public static final int MODE_PRIVATE = 0x0000;
  public abstract SharedPreferences getSharedPreferences(String name, int mode);
  public abstract Object getSystemService(String name);
  public abstract PackageManager getPackageManager();
  public abstract String getPackageName();
  public abstract java.io.File getCacheDir();
  public abstract void startActivity(Intent intent);
  public abstract ComponentName startService(Intent intent);
  public abstract ComponentName startForegroundService(Intent intent);
  public abstract boolean stopService(Intent intent);
  public abstract int checkSelfPermission(String permission);
}
