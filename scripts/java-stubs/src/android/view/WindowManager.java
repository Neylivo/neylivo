package android.view;
public interface WindowManager {
  public static class LayoutParams {
    public static final int FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS = 0x80000000;
    // v1.556.0: содержимое окна не отдаётся снимкам, записи экрана и списку
    // недавних задач. Значение — как в android.view.WindowManager.LayoutParams.
    public static final int FLAG_SECURE = 0x00002000;
  }
}
