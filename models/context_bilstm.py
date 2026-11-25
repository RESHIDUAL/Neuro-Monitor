import tensorflow as tf
from tensorflow.keras import layers, models

def build_context_bilstm(window_shape, context_dim=5, num_classes=3, learning_rate=1e-3):
    window_input = layers.Input(shape=window_shape, name="window_input")
    context_input = layers.Input(shape=(context_dim,), name="context_input")
    
    x = layers.Bidirectional(layers.LSTM(64, return_sequences=True), name="bilstm_1")(window_input)
    x = layers.Dropout(0.3, name="dropout_1")(x)
    x = layers.Bidirectional(layers.LSTM(32), name="bilstm_2")(x)
    x = layers.Dropout(0.3, name="dropout_2")(x)
    
    merged = layers.Concatenate(name="merge_context")([x, context_input])
    d = layers.Dense(32, activation="relu", name="dense_1")(merged)
    output_layer = layers.Dense(num_classes, activation="softmax", name="output")(d)
    
    model = models.Model(inputs=[window_input, context_input], outputs=output_layer, name="Context_BiLSTM")
    optimizer = tf.keras.optimizers.Adam(learning_rate=learning_rate)
    model.compile(
        optimizer=optimizer,
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model
