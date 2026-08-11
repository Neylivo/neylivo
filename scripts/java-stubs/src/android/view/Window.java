package android.view;
public abstract class Window {
  public void addFlags(int flags) { }
  public void clearFlags(int flags) { }
  public void setStatusBarColor(int color) { }
  public void setNavigationBarColor(int color) { }
  public void setDecorFitsSystemWindows(boolean decorFitsSystemWindows) { }
  public abstract View getDecorView();
}
