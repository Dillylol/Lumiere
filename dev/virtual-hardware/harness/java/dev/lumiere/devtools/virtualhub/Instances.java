package dev.lumiere.devtools.virtualhub;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/** Creates objects without running their constructors, for SDK classes whose constructors need a phone. */
final class Instances {
    private Instances() {
    }

    static <T> T withoutConstructor(Class<T> type) {
        try {
            Field field = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe");
            field.setAccessible(true);
            Object unsafe = field.get(null);
            Method allocate = unsafe.getClass().getMethod("allocateInstance", Class.class);
            return type.cast(allocate.invoke(unsafe, type));
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Could not create " + type.getName() + " without its constructor.", e);
        }
    }
}
