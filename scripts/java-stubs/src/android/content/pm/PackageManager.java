package android.content.pm;
public abstract class PackageManager {
  public static final int PERMISSION_GRANTED = 0;
  public abstract boolean canRequestPackageInstalls();
}
