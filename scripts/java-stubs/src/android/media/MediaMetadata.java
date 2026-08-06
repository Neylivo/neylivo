package android.media;
import android.graphics.Bitmap;
public class MediaMetadata {
  public static final String METADATA_KEY_TITLE = "android.media.metadata.TITLE";
  public static final String METADATA_KEY_ARTIST = "android.media.metadata.ARTIST";
  public static final String METADATA_KEY_ALBUM = "android.media.metadata.ALBUM";
  public static final String METADATA_KEY_DURATION = "android.media.metadata.DURATION";
  public static final String METADATA_KEY_ALBUM_ART = "android.media.metadata.ALBUM_ART";
  public static final String METADATA_KEY_ART = "android.media.metadata.ART";
  public static class Builder {
    public Builder() { }
    public Builder putString(String key, String value) { return this; }
    public Builder putLong(String key, long value) { return this; }
    public Builder putBitmap(String key, Bitmap value) { return this; }
    public MediaMetadata build() { return null; }
  }
}
