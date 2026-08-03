package android.content;
import android.net.Uri;
public class Intent {
  public static final String ACTION_VIEW = "android.intent.action.VIEW";
  public static final int FLAG_GRANT_READ_URI_PERMISSION = 1;
  public static final int FLAG_ACTIVITY_NEW_TASK = 2;
  public static final int FLAG_ACTIVITY_CLEAR_TOP = 4;
  public Intent() { }
  public Intent(String action) { }
  public Intent(String action, Uri uri) { }
  public Intent(Context packageContext, Class<?> cls) { }
  public Intent setDataAndType(Uri data, String type) { return this; }
  public Intent addFlags(int flags) { return this; }
  public Intent setFlags(int flags) { return this; }
  public Intent setAction(String action) { return this; }
  public Intent putExtra(String name, String value) { return this; }
  public String getAction() { return null; }
  public String getStringExtra(String name) { return null; }
}
