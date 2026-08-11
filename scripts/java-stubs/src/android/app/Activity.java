package android.app;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.Window;
public class Activity extends Context {
  public void onCreate(Bundle savedInstanceState) { }
  public Window getWindow() { return null; }
  public void runOnUiThread(Runnable action) { }
  public SharedPreferences getSharedPreferences(String name, int mode) { return null; }
  public void requestPermissions(String[] permissions, int requestCode) { }
  public Object getSystemService(String name) { return null; }
  public PackageManager getPackageManager() { return null; }
  public String getPackageName() { return null; }
  public java.io.File getCacheDir() { return null; }
  public void startActivity(Intent intent) { }
  public ComponentName startService(Intent intent) { return null; }
  public ComponentName startForegroundService(Intent intent) { return null; }
  public boolean stopService(Intent intent) { return false; }
  public int checkSelfPermission(String permission) { return 0; }
}
