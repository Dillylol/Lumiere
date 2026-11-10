package com.pedropathing.revhub;

import java.util.function.Supplier;

/**
 * Test stand-in for Pedro Pathing's {@code ConfigVar}: a setting that is set with {@code set} and read
 * with {@code get}, which throws when the setting was never set, as Pedro's required settings do.
 */
public final class FakeVar<T> implements Supplier<T> {
    private T value;
    private boolean set;

    public void set(T value) {
        this.value = value;
        set = true;
    }

    @Override
    public T get() {
        if (!set) throw new IllegalStateException("Config variable has not been set");
        return value;
    }
}
