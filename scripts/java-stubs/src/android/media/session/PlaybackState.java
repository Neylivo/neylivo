package android.media.session;
public class PlaybackState {
  public static final int STATE_PLAYING = 3;
  public static final int STATE_PAUSED = 2;
  public static final long ACTION_PLAY = 4L;
  public static final long ACTION_PAUSE = 2L;
  public static final long ACTION_PLAY_PAUSE = 512L;
  public static final long ACTION_STOP = 1L;
  public static final long ACTION_SKIP_TO_NEXT = 32L;
  public static final long ACTION_SKIP_TO_PREVIOUS = 16L;
  public static final long ACTION_SEEK_TO = 256L;
  public static class Builder {
    public Builder() { }
    public Builder setActions(long actions) { return this; }
    public Builder setState(int state, long position, float playbackSpeed) { return this; }
    public PlaybackState build() { return null; }
  }
}
