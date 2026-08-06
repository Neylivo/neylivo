package android.app;
import android.content.Context;
import android.content.Intent;
public class PendingIntent {
  public static final int FLAG_UPDATE_CURRENT = 134217728;
  public static final int FLAG_IMMUTABLE = 67108864;
  public static final int FLAG_MUTABLE = 33554432;
  public static PendingIntent getService(Context context, int requestCode, Intent intent, int flags) { return null; }
  public static PendingIntent getActivity(Context context, int requestCode, Intent intent, int flags) { return null; }
}
