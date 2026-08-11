package android.app;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.IBinder;
public abstract class Service extends Context {
  public static final int START_NOT_STICKY = 2;
  public static final int START_STICKY = 1;
  public static final int STOP_FOREGROUND_REMOVE = 1;
  public static final int STOP_FOREGROUND_DETACH = 2;
  public abstract IBinder onBind(Intent intent);
  public int onStartCommand(Intent intent, int flags, int startId) { return START_NOT_STICKY; }
  public void onCreate() { }
  public void onDestroy() { }
  public final void stopSelf() { }
  public final void startForeground(int id, Notification notification) { }
  public final void startForeground(int id, Notification notification, int foregroundServiceType) { }
  public final void stopForeground(boolean removeNotification) { }
  public final void stopForeground(int flags) { }
  public Object getSystemService(String name) { return null; }
  public PackageManager getPackageManager() { return null; }
  public String getPackageName() { return null; }
  public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return null; }
  public java.io.File getCacheDir() { return null; }
  public void startActivity(Intent intent) { }
  public ComponentName startService(Intent intent) { return null; }
  public ComponentName startForegroundService(Intent intent) { return null; }
  public boolean stopService(Intent intent) { return false; }
  public int checkSelfPermission(String permission) { return 0; }
}
