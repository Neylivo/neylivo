package com.getcapacitor;
import android.app.Activity;
import android.content.Context;
public class Plugin {
  public Context getContext() { return null; }
  public Activity getActivity() { return null; }
  public void notifyListeners(String eventName, JSObject data) { }
  public void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) { }
  public void load() { }
  protected void handleOnDestroy() { }
}
