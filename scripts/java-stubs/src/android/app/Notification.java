package android.app;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.session.MediaSession;
public class Notification {
  public static final int VISIBILITY_PUBLIC = 1;
  public static class Action {
    public static class Builder {
      public Builder(int icon, CharSequence title, PendingIntent intent) { }
      public Action build() { return null; }
    }
  }
  public static abstract class Style { }
  public static class MediaStyle extends Style {
    public MediaStyle() { }
    public MediaStyle setMediaSession(MediaSession.Token token) { return this; }
    public MediaStyle setShowActionsInCompactView(int... actions) { return this; }
  }
  public static class Builder {
    public Builder(Context context) { }
    public Builder(Context context, String channelId) { }
    public Builder setContentTitle(CharSequence title) { return this; }
    public Builder setContentText(CharSequence text) { return this; }
    public Builder setSmallIcon(int icon) { return this; }
    public Builder setContentIntent(PendingIntent intent) { return this; }
    public Builder setOngoing(boolean ongoing) { return this; }
    public Builder setVisibility(int visibility) { return this; }
    public Builder setSubText(CharSequence text) { return this; }
    public Builder setShowWhen(boolean show) { return this; }
    public Builder setLargeIcon(Bitmap icon) { return this; }
    public Builder setDeleteIntent(PendingIntent intent) { return this; }
    public Builder addAction(Action action) { return this; }
    public Builder setStyle(Style style) { return this; }
    public Notification build() { return null; }
  }
}
