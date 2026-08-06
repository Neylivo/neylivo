package android.media.session;
import android.content.Context;
import android.media.MediaMetadata;
public class MediaSession {
  public static final int FLAG_HANDLES_MEDIA_BUTTONS = 1;
  public static final int FLAG_HANDLES_TRANSPORT_CONTROLS = 2;
  public MediaSession(Context context, String tag) { }
  public void setCallback(Callback callback) { }
  public void setFlags(int flags) { }
  public void setActive(boolean active) { }
  public void setMetadata(MediaMetadata metadata) { }
  public void setPlaybackState(PlaybackState state) { }
  public Token getSessionToken() { return null; }
  public void release() { }
  public static final class Token { }
  public static abstract class Callback {
    public void onPlay() { }
    public void onPause() { }
    public void onStop() { }
    public void onSkipToNext() { }
    public void onSkipToPrevious() { }
    public void onSeekTo(long pos) { }
  }
}
