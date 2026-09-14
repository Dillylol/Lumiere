package dev.lumiere.sim;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Finds the OpModes a Driver Station would list, by scanning compiled classes on the class path. */
public final class OpModeCatalog {
    /** An OpMode that can be selected in the simulator. */
    public static final class Entry {
        public final String name;
        public final String group;
        /** "autonomous" or "teleop". */
        public final String flavor;
        public final Class<? extends OpMode> type;

        Entry(String name, String group, String flavor, Class<? extends OpMode> type) {
            this.name = name;
            this.group = group;
            this.flavor = flavor;
            this.type = type;
        }
    }

    private OpModeCatalog() {
    }

    /**
     * Scans the class path for OpModes in the given package (for example
     * {@code org.firstinspires.ftc.teamcode}). Both class directories and jars are searched, because
     * Android unit tests package an app module's classes into a jar. Only the given package is
     * considered, so SDK samples and libraries are not listed.
     */
    public static List<Entry> scan(String packagePrefix) {
        String relative = packagePrefix.replace('.', File.separatorChar);
        String entryPrefix = packagePrefix.replace('.', '/') + "/";
        Map<String, Entry> byName = new LinkedHashMap<>();
        java.util.Set<String> visited = new java.util.HashSet<>();
        java.util.Deque<String> pending = new java.util.ArrayDeque<>(java.util.Arrays.asList(
                System.getProperty("java.class.path", "").split(File.pathSeparator)));
        while (!pending.isEmpty()) {
            String element = pending.pop();
            if (element.isEmpty() || !visited.add(element)) continue;
            Path root = Paths.get(element);
            if (Files.isDirectory(root)) {
                Path packageRoot = root.resolve(relative);
                if (!Files.isDirectory(packageRoot)) continue;
                try (Stream<Path> files = Files.walk(packageRoot)) {
                    files.filter(path -> path.toString().endsWith(".class"))
                            .forEach(path -> consider(classNameOf(root.relativize(path).toString(), File.separatorChar), byName));
                } catch (IOException e) {
                    // Skip unreadable class-path entries.
                }
            } else if (element.endsWith(".jar") && Files.isRegularFile(root)) {
                try (java.util.jar.JarFile jar = new java.util.jar.JarFile(root.toFile())) {
                    java.util.Enumeration<java.util.jar.JarEntry> entries = jar.entries();
                    while (entries.hasMoreElements()) {
                        String name = entries.nextElement().getName();
                        if (name.startsWith(entryPrefix) && name.endsWith(".class")) consider(classNameOf(name, '/'), byName);
                    }
                    // Test workers may use a manifest-only jar to shorten long class paths.
                    java.util.jar.Manifest manifest = jar.getManifest();
                    String classPath = manifest == null ? null : manifest.getMainAttributes().getValue("Class-Path");
                    if (classPath != null) {
                        for (String reference : classPath.trim().split("\\s+")) {
                            try {
                                pending.add(Paths.get(root.toUri().resolve(reference)).toString());
                            } catch (RuntimeException ignored) {
                                // Skip malformed manifest entries.
                            }
                        }
                    }
                } catch (IOException e) {
                    // Skip unreadable jars.
                }
            }
        }
        List<Entry> entries = new ArrayList<>(byName.values());
        Collections.sort(entries, (a, b) -> {
            int flavor = a.flavor.compareTo(b.flavor);
            if (flavor != 0) return flavor;
            int group = a.group.compareToIgnoreCase(b.group);
            return group != 0 ? group : a.name.compareToIgnoreCase(b.name);
        });
        return entries;
    }

    public static Entry find(List<Entry> entries, String name) {
        for (Entry entry : entries) {
            if (entry.name.equals(name)) return entry;
        }
        return null;
    }

    private static String classNameOf(String relativePath, char separator) {
        return relativePath.substring(0, relativePath.length() - ".class".length()).replace(separator, '.');
    }

    private static void consider(String className, Map<String, Entry> byName) {
        Class<?> type;
        try {
            type = Class.forName(className, false, OpModeCatalog.class.getClassLoader());
        } catch (ClassNotFoundException | LinkageError e) {
            return;
        }
        Entry entry = entryFor(type);
        if (entry != null && !byName.containsKey(entry.name)) byName.put(entry.name, entry);
    }

    @SuppressWarnings("unchecked")
    static Entry entryFor(Class<?> type) {
        if (!OpMode.class.isAssignableFrom(type) || Modifier.isAbstract(type.getModifiers())) return null;
        if (!Modifier.isPublic(type.getModifiers()) || type.isAnnotationPresent(Disabled.class)) return null;
        Autonomous autonomous = type.getAnnotation(Autonomous.class);
        if (autonomous != null) {
            return new Entry(nameOr(autonomous.name(), type), autonomous.group(), "autonomous", (Class<? extends OpMode>) type);
        }
        TeleOp teleOp = type.getAnnotation(TeleOp.class);
        if (teleOp != null) {
            return new Entry(nameOr(teleOp.name(), type), teleOp.group(), "teleop", (Class<? extends OpMode>) type);
        }
        return null;
    }

    private static String nameOr(String name, Class<?> type) {
        return name == null || name.isEmpty() ? type.getSimpleName() : name;
    }
}
