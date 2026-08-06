package android.app;
public class NotificationManager {
  public void notify(int id, Notification notification) { }
  public static final int IMPORTANCE_LOW = 2;
  public void createNotificationChannel(NotificationChannel channel) { }
  public NotificationChannel getNotificationChannel(String channelId) { return null; }
  public boolean areNotificationsEnabled() { return true; }
}
